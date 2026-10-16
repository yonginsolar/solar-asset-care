-- A suspended or role-changed contact must still be removable; new links still require an active client.
create or replace function private.service_admin_action(p_org uuid,p_action text,p_payload jsonb default '{}'::jsonb)
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
     if p_action='customers.link_contact' and not exists(select 1 from public.organization_members where organization_id=p_org and user_id=target and role='client' and status='active')
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
notify pgrst,'reload schema';
