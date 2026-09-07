-- Record the minimum equipment and consent details required for a real
-- requester registration while preserving the existing secured plant RPC.

create or replace function private.create_requester_plant_with_details(
  p_name text,
  p_address text,
  p_capacity_kw numeric,
  p_commissioned_on date,
  p_operator_type text,
  p_module_model text,
  p_inverter_model text,
  p_data_use_consent boolean
)
returns public.plants
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  created_plant public.plants%rowtype;
begin
  if not coalesce(p_data_use_consent, false) then
    raise exception '점검 처리에 필요한 정보 이용 동의가 필요합니다.';
  end if;

  created_plant := private.create_requester_plant(
    p_name,
    p_address,
    p_capacity_kw,
    p_commissioned_on
  );

  update public.plants
  set metadata = jsonb_strip_nulls(
        jsonb_build_object(
          'operator_type', nullif(trim(p_operator_type), ''),
          'module_model', nullif(trim(p_module_model), ''),
          'inverter_model', nullif(trim(p_inverter_model), ''),
          'data_use_consent_at', now(),
          'data_use_consent_version', 'operational-registration-v1'
        )
      )
  where id = created_plant.id
  returning * into created_plant;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    created_plant.organization_id,
    actor_id,
    'requester.plant_details_recorded',
    'plant',
    created_plant.id::text,
    jsonb_build_object('consent_version', 'operational-registration-v1')
  );

  return created_plant;
end;
$$;

create or replace function public.create_requester_plant_with_details(
  p_name text,
  p_address text,
  p_capacity_kw numeric,
  p_commissioned_on date,
  p_operator_type text,
  p_module_model text,
  p_inverter_model text,
  p_data_use_consent boolean
)
returns public.plants
language sql
security invoker
set search_path = ''
as $$
  select private.create_requester_plant_with_details(
    p_name,
    p_address,
    p_capacity_kw,
    p_commissioned_on,
    p_operator_type,
    p_module_model,
    p_inverter_model,
    p_data_use_consent
  );
$$;

revoke all on function private.create_requester_plant_with_details(
  text, text, numeric, date, text, text, text, boolean
) from public, anon;
grant execute on function private.create_requester_plant_with_details(
  text, text, numeric, date, text, text, text, boolean
) to authenticated;
revoke all on function public.create_requester_plant_with_details(
  text, text, numeric, date, text, text, text, boolean
) from public, anon;
grant execute on function public.create_requester_plant_with_details(
  text, text, numeric, date, text, text, text, boolean
) to authenticated;

comment on function public.create_requester_plant_with_details(
  text, text, numeric, date, text, text, text, boolean
) is 'Creates a requester-owned plant with equipment details and a server-timestamped data-use consent record.';
