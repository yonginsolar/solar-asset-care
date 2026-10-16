-- Private operational configuration, immutable published legal versions, named
-- customer contacts. No policy is activated and no consent is fabricated here.
create table private.service_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  revision bigint not null default 1,
  draft jsonb not null default '{}'::jsonb,
  active_version_id uuid,
  updated_at timestamptz not null default now()
);
create table private.service_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  content jsonb not null,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  unique(organization_id, version), unique(organization_id, id)
);
alter table private.service_settings add foreign key(organization_id, active_version_id)
 references private.service_policy_versions(organization_id, id) deferrable initially deferred;
create index service_policy_publisher_idx on private.service_policy_versions(published_by);
create table private.account_details (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  details jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(organization_id, user_id)
);
create index account_details_user_idx on private.account_details(user_id);
create table private.service_consents (
  organization_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  policy_version_id uuid not null,
  accepted_at timestamptz not null default now(),
  primary key(organization_id, user_id, policy_version_id),
  foreign key(organization_id, policy_version_id)
    references private.service_policy_versions(organization_id, id) on delete cascade
);
create index service_consents_user_idx on private.service_consents(user_id);
create index service_consents_version_idx on private.service_consents(policy_version_id);
create table private.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check(kind in ('individual','sole_proprietor','corporation')),
  name text not null check(length(name) between 1 and 160),
  business_number text,
  representative text,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  unique(organization_id,id),
  check ((kind = 'individual' and business_number is null) or
    (kind <> 'individual' and business_number ~ '^[0-9]{10}$' and length(representative) between 1 and 80))
);
create unique index customer_business_number_idx on private.customer_accounts(organization_id,business_number)
 where business_number is not null;
create table private.customer_contacts (
  organization_id uuid not null,
  customer_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  revision bigint not null default 1,
  primary key(customer_id,user_id),
  foreign key(organization_id,customer_id) references private.customer_accounts(organization_id,id) on delete cascade
);
create index customer_contacts_org_idx on private.customer_contacts(organization_id);
create index customer_contacts_user_idx on private.customer_contacts(user_id);
create table private.customer_plants (
  organization_id uuid not null,
  customer_id uuid not null,
  plant_id uuid not null references public.plants(id) on delete cascade,
  primary key(customer_id,plant_id),
  foreign key(organization_id,customer_id) references private.customer_accounts(organization_id,id) on delete cascade
);
create index customer_plants_org_idx on private.customer_plants(organization_id);
create index customer_plants_plant_idx on private.customer_plants(plant_id);
do $$ declare t text; begin
  foreach t in array array['service_settings','service_policy_versions','account_details','service_consents',
    'customer_accounts','customer_contacts','customer_plants'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated',t);
    execute format('create policy no_direct_client_access on private.%I for all to anon,authenticated using(false) with check(false)',t);
  end loop;
end $$;

create function private.service_member(p_org uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m join auth.users u on u.id=m.user_id
   where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.status='active'
   and (p_roles is null or m.role=any(p_roles)) and u.deleted_at is null and u.email_confirmed_at is not null
   and not exists(select 1 from private.invited_password_setups s where s.user_id=u.id and s.required));
$$;
create function private.service_ready(p_org uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.service_member(p_org) and (
   not private.service_member(p_org,array['client']) or exists(select 1 from private.account_details
     where organization_id=p_org and user_id=(select auth.uid()))
 ) and (
   not exists(select 1 from private.service_settings where organization_id=p_org and active_version_id is not null)
   or (exists(select 1 from private.account_details d where d.organization_id=p_org and d.user_id=(select auth.uid()))
     and exists(select 1 from private.service_consents c join private.service_settings s
       on s.organization_id=c.organization_id and s.active_version_id=c.policy_version_id
       where c.organization_id=p_org and c.user_id=(select auth.uid())))
 );
$$;
create function private.customer_plant_access(p_plant uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.customer_plants cp join private.customer_contacts cc
   on cc.customer_id=cp.customer_id and cc.organization_id=cp.organization_id
   where cp.plant_id=p_plant and cc.user_id=(select auth.uid()) and cc.active
   and private.service_member(cp.organization_id,array['client']) and private.service_ready(cp.organization_id));
$$;
create function private.valid_business_number(p_number text)
returns boolean language plpgsql immutable set search_path='' as $$
declare weights integer[]:=array[1,3,7,1,3,7,1,3,5]; total integer:=0; i integer;
begin
 if p_number is null or p_number !~ '^[0-9]{10}$' then return false; end if;
 for i in 1..9 loop total:=total+substr(p_number,i,1)::integer*weights[i]; end loop;
 total:=total+(substr(p_number,9,1)::integer*5)/10;
 return (10-total%10)%10=substr(p_number,10,1)::integer;
end $$;

-- Anonymous callers can only read the current published primary operator policy.
create function private.get_public_service_policy()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('id',v.id,'version',v.version,'content',v.content,'published_at',v.published_at)
 from private.service_settings s join private.service_policy_versions v on v.id=s.active_version_id
 join public.organizations o on o.id=s.organization_id where o.is_primary_operator limit 1),'null'::jsonb);
$$;
create function public.get_public_service_policy() returns jsonb language sql security invoker set search_path=''
as $$select private.get_public_service_policy()$$;

create function private.get_service_onboarding(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.service_member(p_org) then raise exception '현재 계정으로 접근할 수 없습니다.'; end if;
 select jsonb_build_object('profile',coalesce((select details from private.account_details
   where organization_id=p_org and user_id=(select auth.uid())),jsonb_build_object('name',p.display_name,'phone',coalesce(p.phone,''))),
   'policy',(select jsonb_build_object('id',v.id,'version',v.version,'content',v.content,'published_at',v.published_at)
     from private.service_settings s join private.service_policy_versions v on v.id=s.active_version_id where s.organization_id=p_org),
   'role',(select role from public.organization_members where organization_id=p_org and user_id=(select auth.uid())),
   'has_profile',exists(select 1 from private.account_details where organization_id=p_org and user_id=(select auth.uid())),
   'ready',private.service_ready(p_org),
   'consents',coalesce((select jsonb_agg(jsonb_build_object('version',v.version,'accepted_at',c.accepted_at,'content',v.content)
     order by c.accepted_at desc) from private.service_consents c join private.service_policy_versions v on v.id=c.policy_version_id
     where c.organization_id=p_org and c.user_id=(select auth.uid())),'[]'::jsonb),
   'customers',coalesce((select jsonb_agg(jsonb_build_object('name',a.name,'kind',a.kind))
     from private.customer_accounts a join private.customer_contacts cc on cc.customer_id=a.id
     where cc.organization_id=p_org and cc.user_id=(select auth.uid()) and cc.active),'[]'::jsonb))
 into result from public.profiles p where p.user_id=(select auth.uid());
 return result;
end $$;
create function public.get_service_onboarding(p_org uuid) returns jsonb language sql security invoker set search_path=''
as $$select private.get_service_onboarding(p_org)$$;

create function private.complete_service_profile(p_org uuid,p_details jsonb,p_policy_id uuid,p_accept boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); current_policy uuid; normalized jsonb; member_role text; kind text; bn text;
begin
 if not private.service_member(p_org) then raise exception '현재 계정으로 접근할 수 없습니다.'; end if;
 perform 1 from public.organizations where id=p_org for update;
 select role into member_role from public.organization_members where organization_id=p_org and user_id=actor;
 if length(trim(coalesce(p_details->>'name',''))) not between 1 and 80
   or coalesce(p_details->>'phone','') !~ '^0[0-9]{8,10}$' then raise exception '이름과 연락처를 확인해 주세요.'; end if;
 normalized:=jsonb_build_object('name',trim(p_details->>'name'),'phone',p_details->>'phone');
 if member_role='client' then
   kind:=p_details->>'kind'; bn:=regexp_replace(coalesce(p_details->>'business_number',''),'[^0-9]','','g');
   if kind is null or kind not in ('individual','sole_proprietor','corporation') then raise exception '고객 구분을 선택해 주세요.'; end if;
   normalized:=normalized||jsonb_build_object('kind',kind);
   if kind<>'individual' then
     if not private.valid_business_number(bn) or length(trim(coalesce(p_details->>'business_name',''))) not between 1 and 160
       or length(trim(coalesce(p_details->>'representative',''))) not between 1 and 80
       then raise exception '사업자 정보와 사업자등록번호를 확인해 주세요.'; end if;
     normalized:=normalized||jsonb_build_object('business_number',bn,'business_name',trim(p_details->>'business_name'),
       'representative',trim(p_details->>'representative'));
   end if;
 end if;
 select active_version_id into current_policy from private.service_settings where organization_id=p_org;
 if p_policy_id is distinct from current_policy then raise exception '약관이 변경되었습니다. 최신 내용을 다시 확인해 주세요.'; end if;
 if current_policy is not null and not exists(select 1 from private.service_consents
   where organization_id=p_org and user_id=actor and policy_version_id=current_policy) and p_accept is not true
   then raise exception '이용약관과 개인정보 수집·이용 내용을 확인하고 동의해 주세요.'; end if;
 insert into private.account_details(organization_id,user_id,details) values(p_org,actor,normalized)
   on conflict(organization_id,user_id) do update set details=excluded.details,updated_at=now();
 update public.profiles set display_name=normalized->>'name',phone=normalized->>'phone' where user_id=actor;
 if current_policy is not null and p_accept is true then
   insert into private.service_consents(organization_id,user_id,policy_version_id) values(p_org,actor,current_policy)
   on conflict do nothing;
 end if;
 insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id)
 values(p_org,actor,'account.profile_completed','profile',actor::text);
end $$;
create function public.complete_service_profile(p_org uuid,p_details jsonb,p_policy_id uuid,p_accept boolean)
returns void language sql security invoker set search_path=''
as $$select private.complete_service_profile(p_org,p_details,p_policy_id,p_accept)$$;

create or replace function private.register_requester()
returns table(organization_id uuid,organization_name text,member_role text)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); op public.organizations%rowtype; m public.organization_members%rowtype;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and deleted_at is null)
 then raise exception '이메일 인증을 먼저 완료해 주세요.'; end if;
 select * into op from public.organizations where is_primary_operator for update;
 if not found then raise exception '서비스 관리자 작업공간이 아직 준비되지 않았습니다.'; end if;
 select * into m from public.organization_members where user_id=actor order by created_at limit 1;
 if found then
   if m.organization_id<>op.id or m.role<>'client' or m.status<>'active'
   then raise exception '이미 초대 또는 다른 역할이 연결되었거나 이용이 중지된 계정입니다. 관리자에게 문의해 주세요.'; end if;
 else
   insert into public.organization_members(organization_id,user_id,role,status,joined_at) values(op.id,actor,'client','active',now());
   insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id)
   values(op.id,actor,'requester.registered','organization_member',actor::text);
 end if;
 return query select op.id,op.name,'client'::text;
end $$;

create function private.service_admin_action(p_org uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.service_settings%rowtype; c private.customer_accounts%rowtype; target uuid; plant uuid;
 version_id uuid; version_no integer; customer uuid; bn text; result jsonb; payload jsonb:=coalesce(p_payload,'{}'::jsonb);
begin
 if not private.service_member(p_org,array['owner']) then raise exception '관리자만 이용할 수 있습니다.'; end if;
 if p_action not like 'settings.%' and not private.service_ready(p_org)
 then raise exception '기본정보와 최신 이용약관 동의를 완료해 주세요.'; end if;
 -- Serialize settings publication and contact/plant changes within one workspace.
 perform 1 from public.organizations where id=p_org for update;
 if p_action='settings.read' then
   select * into cfg from private.service_settings where organization_id=p_org;
   return jsonb_build_object('revision',coalesce(cfg.revision,0),'draft',coalesce(cfg.draft,'{}'::jsonb),
     'active_id',cfg.active_version_id,'versions',coalesce((select jsonb_agg(to_jsonb(v) order by version desc)
       from private.service_policy_versions v where v.organization_id=p_org),'[]'::jsonb),
     'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',p.display_name,
       'role',m.role,'status',m.status,'profile_complete',d.user_id is not null,
       'accepted_at',co.accepted_at)) from public.organization_members m join public.profiles p on p.user_id=m.user_id
       left join private.account_details d on d.organization_id=m.organization_id and d.user_id=m.user_id
       left join private.service_consents co on co.organization_id=m.organization_id and co.user_id=m.user_id
         and co.policy_version_id=cfg.active_version_id where m.organization_id=p_org and private.service_ready(p_org)),'[]'::jsonb));
 elsif p_action in ('settings.save','settings.publish') then
   select * into cfg from private.service_settings where organization_id=p_org;
   if coalesce((payload->>'revision')::bigint,-1)<>coalesce(cfg.revision,0) then
     raise exception '운영 설정이 변경되었습니다. 새로고침 후 다시 확인해 주세요.';
   end if;
   if p_action='settings.save' then
     if jsonb_typeof(payload->'content')<>'object' then raise exception '설정 내용을 확인해 주세요.'; end if;
     -- Explicit allowlist: no account data or arbitrary HTML/config can be saved.
     select jsonb_object_agg(key,trim(value)) into result from jsonb_each_text(payload->'content')
     where key=any(array['operator_name','contact_email','privacy_contact','terms','privacy']);
     if exists(select 1 from jsonb_each_text(result) where length(value)>30000) then raise exception '입력 내용이 너무 깁니다.'; end if;
     insert into private.service_settings(organization_id,draft) values(p_org,coalesce(result,'{}'::jsonb))
     on conflict(organization_id) do update set draft=excluded.draft,revision=private.service_settings.revision+1,updated_at=now();
   else
     if payload->>'confirm' is distinct from 'APPLY' then raise exception '적용 확인이 필요합니다.'; end if;
     if length(coalesce(cfg.draft->>'operator_name',''))<2 or coalesce(cfg.draft->>'contact_email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or length(coalesce(cfg.draft->>'privacy_contact',''))<3 or length(coalesce(cfg.draft->>'terms',''))<40
       or length(coalesce(cfg.draft->>'privacy',''))<40 then raise exception '운영주체·연락처·약관·개인정보 내용을 모두 확정해 주세요.'; end if;
     select coalesce(max(version),0)+1 into version_no from private.service_policy_versions where organization_id=p_org;
     insert into private.service_policy_versions(organization_id,version,content,published_by)
     values(p_org,version_no,cfg.draft,(select auth.uid())) returning id into version_id;
     update private.service_settings set active_version_id=version_id,revision=revision+1,updated_at=now() where organization_id=p_org;
   end if;
 elsif p_action='customers.read' then
   return jsonb_build_object('customers',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
     from private.customer_accounts a where a.organization_id=p_org),'[]'::jsonb),
     'contacts',coalesce((select jsonb_agg(to_jsonb(cc)) from private.customer_contacts cc where cc.organization_id=p_org),'[]'::jsonb),
     'plants',coalesce((select jsonb_agg(to_jsonb(cp)) from private.customer_plants cp where cp.organization_id=p_org),'[]'::jsonb),
     'applicants',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',p.display_name,'email',p.email,'details',d.details))
     from public.organization_members m join public.profiles p on p.user_id=m.user_id left join private.account_details d
     on d.organization_id=m.organization_id and d.user_id=m.user_id where m.organization_id=p_org and m.role='client' and m.status='active'),'[]'::jsonb));
 elsif p_action='customers.create' then
   bn:=case when payload->>'kind'='individual' then null else regexp_replace(coalesce(payload->>'business_number',''),'[^0-9]','','g') end;
   if bn is not null and not private.valid_business_number(bn) then raise exception '사업자등록번호를 확인해 주세요.'; end if;
   insert into private.customer_accounts(organization_id,kind,name,business_number,representative)
   values(p_org,payload->>'kind',trim(payload->>'name'),bn,nullif(trim(payload->>'representative'),'')) returning id into customer;
 else
   customer:=(payload->>'customer_id')::uuid;
   select * into c from private.customer_accounts where organization_id=p_org and id=customer for update;
   if not found then raise exception '고객을 찾을 수 없습니다.'; end if;
   if coalesce((payload->>'revision')::bigint,-1)<>c.revision then raise exception '고객 정보가 변경되었습니다. 다시 불러와 주세요.'; end if;
   if p_action in ('customers.link_contact','customers.unlink_contact') then
     target:=(payload->>'user_id')::uuid;
     if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=target and role='client' and status='active')
       then raise exception '같은 작업공간의 활성 고객만 연결할 수 있습니다.'; end if;
     if p_action='customers.link_contact' then
       insert into private.customer_contacts(organization_id,customer_id,user_id) values(p_org,customer,target)
       on conflict(customer_id,user_id) do update set active=true,revision=private.customer_contacts.revision+1;
     else
       update private.customer_contacts set active=false,revision=revision+1 where customer_id=customer and user_id=target;
     end if;
   elsif p_action in ('customers.link_plant','customers.unlink_plant') then
     plant:=(payload->>'plant_id')::uuid;
     if not exists(select 1 from public.plants where id=plant and organization_id=p_org) then raise exception '같은 작업공간의 발전소만 연결할 수 있습니다.'; end if;
     if p_action='customers.link_plant' then
       insert into private.customer_plants(organization_id,customer_id,plant_id) values(p_org,customer,plant) on conflict do nothing;
     else delete from private.customer_plants where customer_id=customer and plant_id=plant; end if;
   else raise exception '지원하지 않는 작업입니다.'; end if;
   update private.customer_accounts set revision=revision+1 where id=customer;
 end if;
 insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id)
 values(p_org,(select auth.uid()),p_action,case when p_action like 'settings.%' then 'service_settings' else 'customer_account' end,
   coalesce(customer::text,p_org::text));
 return jsonb_build_object('ok',true);
end $$;
create function public.service_admin_action(p_org uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path=''
as $$select private.service_admin_action(p_org,p_action,p_payload)$$;

-- Keep canonical role/password checks, add current server-side consent readiness.
create or replace function private.has_org_role(p_organization_id uuid,p_roles text[] default null)
returns boolean language sql stable security definer set search_path='' as $$
 select private.service_member(p_organization_id,p_roles) and private.service_ready(p_organization_id);
$$;
-- Add a restrictive gate to all existing business tables, irrespective of their
-- permissive policies. Account/membership lookup remains available for onboarding.
do $$ declare t text; begin
 foreach t in array array['plants','inspections','inspection_files','analysis_runs','findings','reports',
 'maintenance_requests','partners','quote_requests','partner_quotes','calculation_settings',
 'inspection_assessments','recycling_certificates','audit_events'] loop
   execute format('create policy service_readiness_gate on public.%I as restrictive for all to authenticated using(private.service_ready(organization_id)) with check(private.service_ready(organization_id))',t);
 end loop;
end $$;

create or replace function private.can_view_plant(p_plant_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.plants p where p.id=p_plant_id and private.service_ready(p.organization_id) and (
   private.service_member(p.organization_id,array['owner'])
   or (private.service_member(p.organization_id,array['client']) and (
     exists(select 1 from public.plant_requesters r where r.plant_id=p.id and r.requester_user_id=(select auth.uid()))
     or private.customer_plant_access(p.id)))
   or (private.service_member(p.organization_id,array['expert']) and exists(select 1 from public.inspections i
     where i.plant_id=p.id and i.assigned_expert_user_id=(select auth.uid())))));
$$;
create or replace function private.can_work_inspection(p_inspection_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.inspections i where i.id=p_inspection_id and private.service_ready(i.organization_id) and (
   private.service_member(i.organization_id,array['owner']) or
   (private.service_member(i.organization_id,array['expert']) and i.assigned_expert_user_id=(select auth.uid()))));
$$;
create or replace function private.can_view_inspection(p_inspection_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.inspections i where i.id=p_inspection_id and (
   private.can_work_inspection(i.id) or (private.service_member(i.organization_id,array['client']) and private.can_view_plant(i.plant_id))));
$$;
create or replace function private.can_view_report(p_report_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.reports r join public.inspections i on i.id=r.inspection_id
   where r.id=p_report_id and (private.can_work_inspection(i.id) or (r.status='published'
     and private.service_member(r.organization_id,array['client']) and private.can_view_plant(i.plant_id))));
$$;
create or replace function private.can_view_finding(p_finding_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.findings f join public.inspections i on i.id=f.inspection_id
   where f.id=p_finding_id and (private.can_work_inspection(i.id) or (f.disposition in ('accepted','modified')
     and private.service_member(f.organization_id,array['client']) and private.can_view_plant(i.plant_id)
     and exists(select 1 from public.reports r where r.inspection_id=i.id and r.status='published'))));
$$;
-- Definer RPCs also go through these write triggers, not just REST RLS.
create function private.enforce_service_ready() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is not null and not private.service_ready(case when tg_op='DELETE' then old.organization_id else new.organization_id end)
 then raise exception '기본정보와 최신 이용약관 동의를 완료해 주세요.'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.enforce_service_ready() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['plants','inspections','inspection_files','analysis_runs','findings','reports',
 'maintenance_requests','partners','quote_requests','partner_quotes','calculation_settings',
 'inspection_assessments','recycling_certificates'] loop
 execute format('create trigger enforce_service_ready before insert or update or delete on public.%I for each row execute function private.enforce_service_ready()',t);
 end loop;
end $$;

-- request_inspection previously only accepted a direct per-person ownership row.
create or replace function private.request_inspection(p_plant_id uuid,p_purpose text,p_notes text)
returns public.inspections language plpgsql security definer set search_path='' as $$
declare p public.plants%rowtype; result public.inspections%rowtype;
begin
 select * into p from public.plants where id=p_plant_id;
 if not found or not private.has_org_role(p.organization_id,array['client']) or not private.can_view_plant(p.id)
 then raise exception '본인 또는 연결된 고객의 발전소에만 점검을 요청할 수 있습니다.'; end if;
 insert into public.inspections(organization_id,plant_id,inspection_code,purpose,status,requested_on,capture_timezone,created_by,notes)
 values(p.organization_id,p.id,'REQ-'||to_char(now() at time zone 'Asia/Seoul','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
 coalesce(nullif(trim(p_purpose),''),'열화상 점검 요청'),'requested',(now() at time zone 'Asia/Seoul')::date,'Asia/Seoul',(select auth.uid()),nullif(trim(p_notes),'')) returning * into result;
 insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id)
 values(p.organization_id,(select auth.uid()),'requester.inspection_requested','inspection',result.id::text);
 return result;
end $$;

do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname in ('service_member','service_ready','customer_plant_access','valid_business_number',
 'get_public_service_policy','get_service_onboarding','complete_service_profile','service_admin_action') loop
   execute format('revoke all on function %s from public,anon,authenticated',r.signature);
   execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end $$;
revoke all on function public.get_public_service_policy() from public;
revoke all on function public.get_service_onboarding(uuid) from public,anon;
revoke all on function public.complete_service_profile(uuid,jsonb,uuid,boolean) from public,anon;
revoke all on function public.service_admin_action(uuid,text,jsonb) from public,anon;
grant usage on schema private to anon;
grant execute on function private.get_public_service_policy(),public.get_public_service_policy() to anon,authenticated;
grant execute on function public.get_service_onboarding(uuid),public.complete_service_profile(uuid,jsonb,uuid,boolean),public.service_admin_action(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
