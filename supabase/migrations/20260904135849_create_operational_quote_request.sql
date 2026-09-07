-- Complete the administrator-operated quotation workflow.
-- One transaction creates a request, assigns exactly three active partners,
-- and records an audit event. Partner replies are also recorded through an
-- audited RPC so partially-created quotation flows are not left behind.

create or replace function private.create_quote_request_with_partners(
  p_plant_id uuid,
  p_requester_user_id uuid,
  p_title text,
  p_scope_summary text,
  p_response_due_at timestamptz,
  p_partner_ids uuid[],
  p_inspection_id uuid default null,
  p_maintenance_request_id uuid default null,
  p_commission_rate numeric default 0
)
returns public.quote_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  plant_row public.plants%rowtype;
  created_request public.quote_requests%rowtype;
  generated_code text;
  active_partner_count integer;
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into plant_row
  from public.plants
  where id = p_plant_id;

  if not found or not private.has_org_role(plant_row.organization_id, array['owner']) then
    raise exception '견적 요청을 만들 권한이 없습니다.';
  end if;
  if not exists (
    select 1
    from public.plant_requesters access
    join public.organization_members membership
      on membership.organization_id = plant_row.organization_id
     and membership.user_id = access.requester_user_id
     and membership.role = 'client'
     and membership.status = 'active'
    where access.plant_id = plant_row.id
      and access.requester_user_id = p_requester_user_id
  ) then
    raise exception '이 발전소에 연결된 활성 의뢰인을 선택해야 합니다.';
  end if;
  if nullif(trim(p_title), '') is null then
    raise exception '견적 요청 제목을 입력해야 합니다.';
  end if;
  if cardinality(p_partner_ids) <> 3
    or (select count(distinct partner_id) from unnest(p_partner_ids) as partner_id) <> 3
  then
    raise exception '서로 다른 업체 3곳을 선택해야 합니다.';
  end if;
  if p_commission_rate < 0 or p_commission_rate > 100 then
    raise exception '수수료율은 0부터 100 사이여야 합니다.';
  end if;

  select count(*) into active_partner_count
  from public.partners partner
  where partner.id = any(p_partner_ids)
    and partner.organization_id = plant_row.organization_id
    and partner.status = 'active';

  if active_partner_count <> 3 then
    raise exception '같은 조직의 사용 중인 업체 3곳만 선택할 수 있습니다.';
  end if;

  generated_code := 'QT-'
    || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD')
    || '-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.quote_requests (
    organization_id,
    plant_id,
    inspection_id,
    maintenance_request_id,
    requester_user_id,
    request_code,
    title,
    scope_summary,
    status,
    response_due_at,
    requested_by,
    requested_at
  ) values (
    plant_row.organization_id,
    plant_row.id,
    p_inspection_id,
    p_maintenance_request_id,
    p_requester_user_id,
    generated_code,
    trim(p_title),
    nullif(trim(p_scope_summary), ''),
    'requested',
    p_response_due_at,
    actor_id,
    now()
  ) returning * into created_request;

  insert into public.partner_quotes (
    organization_id,
    quote_request_id,
    partner_id,
    status,
    commission_rate,
    requested_at,
    created_by
  )
  select
    plant_row.organization_id,
    created_request.id,
    partner_id,
    'requested',
    p_commission_rate,
    now(),
    actor_id
  from unnest(p_partner_ids) as partner_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    plant_row.organization_id,
    actor_id,
    'quote.requested',
    'quote_request',
    created_request.id::text,
    jsonb_build_object(
      'plant_id', plant_row.id,
      'requester_user_id', p_requester_user_id,
      'partner_ids', p_partner_ids,
      'response_due_at', p_response_due_at
    )
  );

  return created_request;
end;
$$;

create or replace function public.create_quote_request_with_partners(
  p_plant_id uuid,
  p_requester_user_id uuid,
  p_title text,
  p_scope_summary text,
  p_response_due_at timestamptz,
  p_partner_ids uuid[],
  p_inspection_id uuid default null,
  p_maintenance_request_id uuid default null,
  p_commission_rate numeric default 0
)
returns public.quote_requests
language sql
security invoker
set search_path = ''
as $$
  select private.create_quote_request_with_partners(
    p_plant_id,
    p_requester_user_id,
    p_title,
    p_scope_summary,
    p_response_due_at,
    p_partner_ids,
    p_inspection_id,
    p_maintenance_request_id,
    p_commission_rate
  );
$$;

create or replace function private.record_partner_quote_response(
  p_quote_id uuid,
  p_amount_krw numeric,
  p_estimated_days integer,
  p_proposed_start_on date,
  p_valid_until date,
  p_scope text,
  p_conditions text,
  p_commission_rate numeric
)
returns public.partner_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  quote_row public.partner_quotes%rowtype;
  request_row public.quote_requests%rowtype;
  saved_quote public.partner_quotes%rowtype;
  total_quotes integer;
  submitted_quotes integer;
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into quote_row
  from public.partner_quotes
  where id = p_quote_id
  for update;

  if not found or not private.has_org_role(quote_row.organization_id, array['owner']) then
    raise exception '견적 회신을 기록할 권한이 없습니다.';
  end if;

  select * into request_row
  from public.quote_requests
  where id = quote_row.quote_request_id
  for update;

  if request_row.status not in ('requested', 'collecting', 'ready_for_selection') then
    raise exception '현재 상태에서는 견적 회신을 변경할 수 없습니다.';
  end if;
  if p_amount_krw is null or p_amount_krw < 0 then
    raise exception '견적 금액을 입력해야 합니다.';
  end if;
  if p_estimated_days is not null and p_estimated_days <= 0 then
    raise exception '예상 기간은 1일 이상이어야 합니다.';
  end if;
  if p_commission_rate < 0 or p_commission_rate > 100 then
    raise exception '수수료율은 0부터 100 사이여야 합니다.';
  end if;
  if p_valid_until is not null and p_proposed_start_on is not null
    and p_valid_until < p_proposed_start_on
  then
    raise exception '견적 유효일은 작업 시작 예정일보다 빠를 수 없습니다.';
  end if;

  update public.partner_quotes
  set amount_krw = p_amount_krw,
      estimated_days = p_estimated_days,
      proposed_start_on = p_proposed_start_on,
      valid_until = p_valid_until,
      scope = nullif(trim(p_scope), ''),
      conditions = nullif(trim(p_conditions), ''),
      commission_rate = p_commission_rate,
      status = 'submitted',
      submitted_by = actor_id,
      submitted_at = now()
  where id = p_quote_id
  returning * into saved_quote;

  select count(*),
         count(*) filter (where status in ('submitted', 'selected', 'not_selected', 'completed'))
  into total_quotes, submitted_quotes
  from public.partner_quotes
  where quote_request_id = request_row.id;

  update public.quote_requests
  set status = case
        when submitted_quotes = total_quotes and total_quotes > 0
          then 'ready_for_selection'
        else 'collecting'
      end
  where id = request_row.id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    quote_row.organization_id,
    actor_id,
    'quote.response_recorded',
    'partner_quote',
    quote_row.id::text,
    jsonb_build_object(
      'quote_request_id', request_row.id,
      'partner_id', quote_row.partner_id,
      'amount_krw', p_amount_krw,
      'estimated_days', p_estimated_days
    )
  );

  return saved_quote;
end;
$$;

create or replace function public.record_partner_quote_response(
  p_quote_id uuid,
  p_amount_krw numeric,
  p_estimated_days integer,
  p_proposed_start_on date,
  p_valid_until date,
  p_scope text,
  p_conditions text,
  p_commission_rate numeric
)
returns public.partner_quotes
language sql
security invoker
set search_path = ''
as $$
  select private.record_partner_quote_response(
    p_quote_id,
    p_amount_krw,
    p_estimated_days,
    p_proposed_start_on,
    p_valid_until,
    p_scope,
    p_conditions,
    p_commission_rate
  );
$$;

revoke all on function private.create_quote_request_with_partners(
  uuid, uuid, text, text, timestamptz, uuid[], uuid, uuid, numeric
) from public, anon;
grant execute on function private.create_quote_request_with_partners(
  uuid, uuid, text, text, timestamptz, uuid[], uuid, uuid, numeric
) to authenticated;
revoke all on function public.create_quote_request_with_partners(
  uuid, uuid, text, text, timestamptz, uuid[], uuid, uuid, numeric
) from public, anon;
grant execute on function public.create_quote_request_with_partners(
  uuid, uuid, text, text, timestamptz, uuid[], uuid, uuid, numeric
) to authenticated;

revoke all on function private.record_partner_quote_response(
  uuid, numeric, integer, date, date, text, text, numeric
) from public, anon;
grant execute on function private.record_partner_quote_response(
  uuid, numeric, integer, date, date, text, text, numeric
) to authenticated;
revoke all on function public.record_partner_quote_response(
  uuid, numeric, integer, date, date, text, text, numeric
) from public, anon;
grant execute on function public.record_partner_quote_response(
  uuid, numeric, integer, date, date, text, text, numeric
) to authenticated;

comment on function public.create_quote_request_with_partners(
  uuid, uuid, text, text, timestamptz, uuid[], uuid, uuid, numeric
) is 'Creates an audited quotation request and assigns exactly three active partners atomically.';
comment on function public.record_partner_quote_response(
  uuid, numeric, integer, date, date, text, text, numeric
) is 'Records an administrator-entered partner response and advances the request when all replies are ready.';
