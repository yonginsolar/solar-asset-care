-- Keep partner company records deduplicated and save public/private fields in
-- one audited transaction. Authenticated browser clients can read the rows
-- allowed by RLS, but all writes go through this owner-only RPC.

create unique index partners_org_type_normalized_name_uidx
  on public.partners (organization_id, partner_type, lower(btrim(name)));

create index partner_private_details_registration_digits_idx
  on public.partner_private_details (
    regexp_replace(business_registration_number, '[^0-9]', '', 'g')
  )
  where nullif(
    regexp_replace(business_registration_number, '[^0-9]', '', 'g'),
    ''
  ) is not null;

create or replace function public.save_partner_profile(
  p_organization_id uuid,
  p_partner_id uuid,
  p_name text,
  p_partner_type text,
  p_service_regions text[],
  p_rating numeric,
  p_status text,
  p_business_registration_number text,
  p_license_registration_number text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  saved_partner_id uuid;
  normalized_name text := nullif(btrim(p_name), '');
  normalized_registration text := nullif(
    regexp_replace(coalesce(p_business_registration_number, ''), '[^0-9]', '', 'g'),
    ''
  );
  normalized_email text := nullif(lower(btrim(p_contact_email)), '');
  normalized_regions text[];
  operation text;
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if not private.has_org_role(p_organization_id, array['owner']) then
    raise exception '업체 정보를 저장할 권한이 없습니다.';
  end if;
  if normalized_name is null or length(normalized_name) > 160 then
    raise exception '업체명은 1자 이상 160자 이하로 입력해 주세요.';
  end if;
  if p_partner_type not in (
    'construction', 'maintenance', 'electrical', 'cleaning', 'dismantling', 'recycling'
  ) then
    raise exception '업체 유형을 확인해 주세요.';
  end if;
  if p_status not in ('active', 'inactive', 'blocked') then
    raise exception '업체 상태를 확인해 주세요.';
  end if;
  if p_rating is not null and (p_rating < 0 or p_rating > 5) then
    raise exception '평점은 0부터 5 사이여야 합니다.';
  end if;
  if normalized_registration is not null and length(normalized_registration) <> 10 then
    raise exception '사업자등록번호는 숫자 10자리로 입력해 주세요.';
  end if;
  if normalized_email is not null
    and normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  then
    raise exception '담당자 이메일 형식을 확인해 주세요.';
  end if;
  if length(coalesce(p_license_registration_number, '')) > 100
    or length(coalesce(p_contact_name, '')) > 100
    or length(coalesce(p_contact_email, '')) > 320
    or length(coalesce(p_contact_phone, '')) > 50
    or length(coalesce(p_notes, '')) > 4000
  then
    raise exception '업체 상세정보 입력 길이를 확인해 주세요.';
  end if;

  select coalesce(array_agg(region order by region), '{}'::text[])
  into normalized_regions
  from (
    select distinct btrim(region) as region
    from unnest(coalesce(p_service_regions, '{}'::text[])) as region
    where nullif(btrim(region), '') is not null
  ) cleaned;

  if normalized_registration is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'partner-registration:' || p_organization_id::text || ':' || normalized_registration,
        0
      )
    );
    if exists (
      select 1
      from public.partner_private_details detail
      join public.partners partner on partner.id = detail.partner_id
      where partner.organization_id = p_organization_id
        and detail.partner_id is distinct from p_partner_id
        and regexp_replace(detail.business_registration_number, '[^0-9]', '', 'g')
          = normalized_registration
    ) then
      raise exception '같은 사업자등록번호의 업체가 이미 등록되어 있습니다.';
    end if;
  end if;

  if p_partner_id is null then
    operation := 'partner.created';
    begin
      insert into public.partners (
        organization_id, name, partner_type, service_regions, rating, status, created_by
      ) values (
        p_organization_id, normalized_name, p_partner_type, normalized_regions,
        p_rating, p_status, actor_id
      ) returning id into saved_partner_id;
    exception when unique_violation then
      raise exception '같은 유형과 이름의 업체가 이미 등록되어 있습니다.';
    end;
  else
    operation := 'partner.updated';
    begin
      update public.partners
      set name = normalized_name,
          partner_type = p_partner_type,
          service_regions = normalized_regions,
          rating = p_rating,
          status = p_status
      where id = p_partner_id
        and organization_id = p_organization_id
      returning id into saved_partner_id;
    exception when unique_violation then
      raise exception '같은 유형과 이름의 업체가 이미 등록되어 있습니다.';
    end;
    if saved_partner_id is null then
      raise exception '수정할 업체를 찾을 수 없습니다.';
    end if;
  end if;

  insert into public.partner_private_details (
    partner_id,
    business_registration_number,
    license_registration_number,
    contact_name,
    contact_email,
    contact_phone,
    notes
  ) values (
    saved_partner_id,
    normalized_registration,
    nullif(btrim(p_license_registration_number), ''),
    nullif(btrim(p_contact_name), ''),
    normalized_email,
    nullif(btrim(p_contact_phone), ''),
    nullif(btrim(p_notes), '')
  )
  on conflict (partner_id) do update
  set business_registration_number = excluded.business_registration_number,
      license_registration_number = excluded.license_registration_number,
      contact_name = excluded.contact_name,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone,
      notes = excluded.notes;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    actor_id,
    operation,
    'partner',
    saved_partner_id::text,
    jsonb_build_object(
      'partner_type', p_partner_type,
      'status', p_status,
      'service_regions', normalized_regions,
      'has_business_registration_number', normalized_registration is not null,
      'has_contact', normalized_email is not null or nullif(btrim(p_contact_phone), '') is not null
    )
  );

  return saved_partner_id;
end;
$$;

revoke all on function public.save_partner_profile(
  uuid, uuid, text, text, text[], numeric, text,
  text, text, text, text, text, text
) from public, anon;
grant execute on function public.save_partner_profile(
  uuid, uuid, text, text, text[], numeric, text,
  text, text, text, text, text, text
) to authenticated;

revoke insert, update, delete on table public.partners from authenticated;
revoke insert, update, delete on table public.partner_private_details from authenticated;

comment on function public.save_partner_profile(
  uuid, uuid, text, text, text[], numeric, text,
  text, text, text, text, text, text
) is 'Creates or updates an owner-managed partner and its private details in one audited transaction.';
