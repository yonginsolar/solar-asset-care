-- CLI-created migration, aligned with the actual remote migration history version.
-- Keep the existing administrator boundary, but never overwrite a newer member.
create function private.set_member_revision() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond'); return new; end $$;
revoke all on function private.set_member_revision() from public,anon,authenticated;
drop trigger organization_members_set_updated_at on public.organization_members;
create trigger organization_members_set_updated_at before update on public.organization_members
 for each row execute function private.set_member_revision();
create function private.admin_update_member(
 p_organization_id uuid, p_user_id uuid, p_role text, p_status text,
 p_expected_updated_at timestamptz
) returns public.organization_members language plpgsql security definer set search_path='' as $$
declare target public.organization_members%rowtype; result public.organization_members%rowtype;
 next_role text; next_status text;
begin
 perform 1 from public.organizations where id=p_organization_id for update;
 if not private.has_org_role(p_organization_id,array['owner']) then
  raise exception '관리자만 계정 권한을 변경할 수 있습니다.'; end if;
 select * into target from public.organization_members
  where organization_id=p_organization_id and user_id=p_user_id for update;
 if not found or target.status='removed' then raise exception '변경할 사용자를 찾을 수 없습니다.'; end if;
 if p_expected_updated_at is null or target.updated_at is distinct from p_expected_updated_at then
  raise exception using errcode='PT409', message='계정 정보가 변경되었습니다. 새로고침 후 다시 확인해 주세요.';
 end if;
 -- Exactly one field is an action. NULL preserves the latest other field.
 if (p_role is null) = (p_status is null) then raise exception '변경할 역할 또는 상태를 하나만 선택해 주세요.'; end if;
 next_role:=coalesce(lower(trim(p_role)),target.role);
 next_status:=coalesce(lower(trim(p_status)),target.status);
 if next_role not in ('owner','expert','client') or next_status not in ('invited','active','suspended') then
  raise exception '지원하지 않는 역할 또는 계정 상태입니다.'; end if;
 update public.organization_members set role=next_role,status=next_status,
  joined_at=case when next_status='active' then coalesce(joined_at,now()) else joined_at end,
  updated_at=greatest(clock_timestamp(),target.updated_at+interval '1 microsecond')
 where organization_id=p_organization_id and user_id=p_user_id returning * into result;
 insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(p_organization_id,(select auth.uid()),'organization.member_updated','organization_member',p_user_id::text,
  jsonb_build_object('role',result.role,'status',result.status));
 return result;
end $$;
create function public.admin_update_member(
 p_organization_id uuid,p_user_id uuid,p_role text,p_status text,p_expected_updated_at timestamptz
) returns public.organization_members language sql security invoker set search_path='' as $$
 select private.admin_update_member(p_organization_id,p_user_id,p_role,p_status,p_expected_updated_at);
$$;
-- Old clients receive an explicit refresh error, not an unchecked write path.
create or replace function private.admin_update_member(p_organization_id uuid,p_user_id uuid,p_role text,p_status text)
returns public.organization_members language plpgsql security definer set search_path='' as $$
begin
 if not private.has_org_role(p_organization_id,array['owner']) then raise exception '관리자만 계정 권한을 변경할 수 있습니다.'; end if;
 raise exception using errcode='PT409',message='계정 관리 화면을 새로고침 후 다시 확인해 주세요.';
end $$;
revoke all on function private.admin_update_member(uuid,uuid,text,text,timestamptz),
 public.admin_update_member(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function private.admin_update_member(uuid,uuid,text,text,timestamptz),
 public.admin_update_member(uuid,uuid,text,text,timestamptz) to authenticated;

-- Analysis runs are evidence. Checked acknowledge/retry APIs remain available.
revoke delete on public.analysis_runs from authenticated;
drop policy if exists analysis_runs_delete_admin on public.analysis_runs;

-- Receipts contain no input payloads/tokens; current access is checked on EVERY replay.
create table private.intake_requests (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('plant','inspection')), request_id uuid not null,
 fingerprint text not null, result_id uuid not null, created_at timestamptz not null default now(),
 primary key(organization_id,actor_user_id,kind,request_id)
);
alter table private.intake_requests enable row level security;
revoke all on private.intake_requests from public,anon,authenticated;
create index intake_requests_actor_idx on private.intake_requests(actor_user_id);

create function private.create_requester_plant_with_details(
 p_name text,p_address text,p_capacity_kw numeric,p_commissioned_on date,
 p_operator_type text,p_module_model text,p_inverter_model text,p_data_use_consent boolean,p_request_id uuid
) returns public.plants language plpgsql security definer set search_path='' as $$
declare org uuid; result public.plants%rowtype; receipt private.intake_requests%rowtype; fingerprint text;
begin
 select organization_id into org from public.organization_members
 where user_id=(select auth.uid()) and role='client' and status='active' limit 1;
 if org is null or not private.service_ready(org) then raise exception '의뢰인 기본정보와 최신 이용약관 동의를 확인해 주세요.'; end if;
 if p_request_id is null then raise exception '등록 요청을 확인해 주세요.'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_array(trim(p_name),trim(p_address),p_capacity_kw,p_commissioned_on,
  trim(p_operator_type),trim(p_module_model),trim(p_inverter_model),p_data_use_consent)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(org::text||(select auth.uid())::text||'plant'||p_request_id::text,527));
 select * into receipt from private.intake_requests where organization_id=org and actor_user_id=(select auth.uid()) and kind='plant' and request_id=p_request_id;
 if found then
  if receipt.fingerprint is distinct from fingerprint then raise exception using errcode='PT409',message='이 요청으로 이미 등록했습니다. 기존 등록 결과를 먼저 확인해 주세요.'; end if;
  select * into result from public.plants where id=receipt.result_id and organization_id=org and private.can_view_plant(id);
  if not found then raise exception '이전 등록 결과를 조회할 수 없습니다. 관리자에게 확인해 주세요.'; end if;
  return result;
 end if;
 result:=private.create_requester_plant_with_details(p_name,p_address,p_capacity_kw,p_commissioned_on,
  p_operator_type,p_module_model,p_inverter_model,p_data_use_consent);
 insert into private.intake_requests(organization_id,actor_user_id,kind,request_id,fingerprint,result_id)
 values(org,(select auth.uid()),'plant',p_request_id,fingerprint,result.id);
 return result;
end $$;
create function public.create_requester_plant_with_details(
 p_name text,p_address text,p_capacity_kw numeric,p_commissioned_on date,
 p_operator_type text,p_module_model text,p_inverter_model text,p_data_use_consent boolean,p_request_id uuid
) returns public.plants language sql security invoker set search_path='' as $$
 select private.create_requester_plant_with_details(p_name,p_address,p_capacity_kw,p_commissioned_on,
  p_operator_type,p_module_model,p_inverter_model,p_data_use_consent,p_request_id);
$$;

create function private.request_inspection(p_plant_id uuid,p_purpose text,p_notes text,p_request_id uuid)
returns public.inspections language plpgsql security definer set search_path='' as $$
declare org uuid; result public.inspections%rowtype; receipt private.intake_requests%rowtype; fingerprint text;
begin
 select organization_id into org from public.plants where id=p_plant_id;
 if org is null or not private.has_org_role(org,array['client']) or not private.service_ready(org) or not private.can_view_plant(p_plant_id)
 then raise exception '본인 또는 연결된 고객의 발전소에만 점검을 요청할 수 있습니다.'; end if;
 if p_request_id is null then raise exception '접수 요청을 확인해 주세요.'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_array(p_plant_id,trim(p_purpose),trim(p_notes))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(org::text||(select auth.uid())::text||'inspection'||p_request_id::text,527));
 select * into receipt from private.intake_requests where organization_id=org and actor_user_id=(select auth.uid()) and kind='inspection' and request_id=p_request_id;
 if found then
  if receipt.fingerprint is distinct from fingerprint then raise exception using errcode='PT409',message='이 요청으로 이미 접수했습니다. 기존 접수 결과를 먼저 확인해 주세요.'; end if;
  select * into result from public.inspections where id=receipt.result_id and organization_id=org and plant_id=p_plant_id;
  if not found then raise exception '이전 접수 결과를 조회할 수 없습니다. 관리자에게 확인해 주세요.'; end if;
  return result;
 end if;
 result:=private.request_inspection(p_plant_id,p_purpose,p_notes);
 insert into private.intake_requests(organization_id,actor_user_id,kind,request_id,fingerprint,result_id)
 values(org,(select auth.uid()),'inspection',p_request_id,fingerprint,result.id);
 return result;
end $$;
create function public.request_inspection(p_plant_id uuid,p_purpose text,p_notes text,p_request_id uuid)
returns public.inspections language sql security invoker set search_path='' as $$
 select private.request_inspection(p_plant_id,p_purpose,p_notes,p_request_id);
$$;
revoke all on function private.create_requester_plant_with_details(text,text,numeric,date,text,text,text,boolean,uuid),
 public.create_requester_plant_with_details(text,text,numeric,date,text,text,text,boolean,uuid),
 private.request_inspection(uuid,text,text,uuid),public.request_inspection(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function private.create_requester_plant_with_details(text,text,numeric,date,text,text,text,boolean,uuid),
 public.create_requester_plant_with_details(text,text,numeric,date,text,text,text,boolean,uuid),
 private.request_inspection(uuid,text,text,uuid),public.request_inspection(uuid,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
