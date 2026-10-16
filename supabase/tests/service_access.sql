-- Synthetic full-schema integration test. Run only on an isolated local DB.
create function public.qa_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;
create function public.qa_denied(statement text,pattern text,label text) returns void language plpgsql as $$
declare failed boolean:=false;
begin
 begin execute statement; exception when others then
   if sqlerrm !~ pattern then raise exception 'Wrong error for %: %',label,sqlerrm; end if; failed:=true;
 end;
 perform public.qa_assert(failed,label);
end$$;
insert into auth.users(email,email_confirmed_at,encrypted_password,raw_user_meta_data)
 values('service-owner@example.invalid',now(),'synthetic','{"name":"가상 관리자"}') returning id as owner_id \gset
insert into auth.users(email,email_confirmed_at,encrypted_password,raw_user_meta_data)
 values('service-expert@example.invalid',now(),'synthetic','{"name":"가상 전문가"}') returning id as expert_id \gset
insert into auth.users(email,email_confirmed_at,encrypted_password,raw_user_meta_data)
 values('service-client-a@example.invalid',now(),'synthetic','{"name":"가상 고객A"}') returning id as client_a \gset
insert into auth.users(email,email_confirmed_at,encrypted_password,raw_user_meta_data)
 values('service-client-b@example.invalid',now(),'synthetic','{"name":"가상 고객B"}') returning id as client_b \gset
insert into auth.users(email,email_confirmed_at,encrypted_password,raw_user_meta_data)
 values('service-foreign@example.invalid',now(),'synthetic','{"name":"가상 외부"}') returning id as foreign_id \gset
insert into public.organizations(name,slug,is_primary_operator) values('가상 시험','service-local-test',true) returning id as org \gset
insert into public.organizations(name,slug) values('가상 타 조직','service-local-other') returning id as other_org \gset
insert into public.organization_members(organization_id,user_id,role,status) values
 (:'org',:'owner_id','owner','active'),(:'org',:'expert_id','expert','active'),
 (:'org',:'client_a','client','active'),(:'org',:'client_b','client','active'),(:'other_org',:'foreign_id','owner','active');
insert into public.plants(organization_id,name,capacity_kw) values(:'org','가상 공유 발전소',10) returning id as plant \gset
insert into public.inspections(organization_id,plant_id,inspection_code,assigned_expert_user_id)
 values(:'org',:'plant','QA-LOCAL',:'expert_id') returning id as inspection \gset
set role anon;
select public.qa_assert(public.get_public_service_policy()='null'::jsonb,'unpublished policy is not public');
select public.qa_denied('select * from private.account_details','permission denied','anon cannot read private account data');
reset role;
select set_config('request.jwt.claim.sub',:'client_a',false);
set role authenticated;
select public.qa_assert(not (public.get_service_onboarding(:'org')->>'ready')::boolean,'new customer is blocked until profile completion');
select public.qa_denied(format('select public.create_requester_plant(%L,%L,10,null)','가상 우회','가상 주소'),'기본정보','old definer RPC cannot bypass profile gate');
select public.qa_denied(format('select public.complete_service_profile(%L,%L,null,false)',:'org','{"name":"고객","phone":"01012345678","kind":"corporation","business_name":"가상","business_number":"1234567890","representative":"가상"}'),'사업자','server rejects invalid business checksum');
select public.complete_service_profile(:'org','{"name":"가상 고객A","phone":"01012345678","kind":"corporation","business_name":"가상 사업자","business_number":"1234567891","representative":"가상 대표"}',null,false);
select public.qa_assert((public.get_service_onboarding(:'org')->>'ready')::boolean,'corporate customer profile completes without fabricated consent');
select public.qa_assert((public.get_service_onboarding(:'org')->'consents')='[]'::jsonb,'no consent recorded before policy publication');
select public.qa_denied(format('select public.service_admin_action(%L,%L)',:'org','customers.read'),'관리자','customer cannot list other accounts');
reset role;
select set_config('request.jwt.claim.sub',:'owner_id',false);
set role authenticated;
select public.service_admin_action(:'org','customers.create','{"kind":"corporation","name":"가상 사업자","business_number":"1234567891","representative":"가상 대표"}');
reset role;
select id as customer from private.customer_accounts where organization_id=:'org' \gset
set role authenticated;
select public.service_admin_action(:'org','customers.link_contact',jsonb_build_object('customer_id',:'customer','revision',1,'user_id',:'client_a'));
select public.qa_denied(format('select public.service_admin_action(%L,%L,%L)',:'org','customers.link_contact',jsonb_build_object('customer_id',:'customer','revision',1,'user_id',:'client_b')),'変更|변경','stale customer revision is rejected');
select public.service_admin_action(:'org','customers.link_contact',jsonb_build_object('customer_id',:'customer','revision',2,'user_id',:'client_b'));
select public.service_admin_action(:'org','customers.link_plant',jsonb_build_object('customer_id',:'customer','revision',3,'plant_id',:'plant'));
select public.qa_denied(format('select public.service_admin_action(%L,%L,%L)',:'org','customers.link_contact',jsonb_build_object('customer_id',:'customer','revision',4,'user_id',:'foreign_id')),'같은 작업공간','cross-organization contact link is denied');
reset role;
select set_config('request.jwt.claim.sub',:'client_a',false);
set role authenticated;
select public.qa_assert((select count(*)=1 from public.plants),'approved contact can see shared customer plant');
select public.qa_assert((select count(*)=1 from public.inspections),'approved contact can see shared inspection');
select public.qa_denied(format('select public.service_admin_action(%L,%L,%L)',:'org','customers.link_contact',jsonb_build_object('customer_id',:'customer','revision',4,'user_id',:'client_a')),'관리자','self-approval is denied');
reset role;
select set_config('request.jwt.claim.sub',:'client_b',false);
set role authenticated;
select public.qa_assert((select count(*)=0 from public.plants),'second contact still needs own profile, not another contact profile');
select public.complete_service_profile(:'org','{"name":"가상 고객B","phone":"01012345679","kind":"individual"}',null,false);
select public.qa_assert((select count(*)=1 from public.plants),'second named login independently receives approved customer access');
reset role;
select set_config('request.jwt.claim.sub',:'owner_id',false);
set role authenticated;
select public.service_admin_action(:'org','customers.unlink_contact',jsonb_build_object('customer_id',:'customer','revision',4,'user_id',:'client_b'));
reset role;
select set_config('request.jwt.claim.sub',:'client_b',false);
set role authenticated;
select public.qa_assert((select count(*)=0 from public.plants),'unlink immediately revokes shared customer access');
reset role;
select public.qa_assert((select count(*)=1 from public.plants),'unlink preserves source plant');
select public.qa_assert((select count(*)=2 from private.customer_contacts),'unlink preserves contact history');
select set_config('request.jwt.claim.sub',:'owner_id',false);
set role authenticated;
select public.qa_denied(format('select public.service_admin_action(%L,%L,%L)',:'org','settings.publish','{"revision":0,"confirm":"APPLY"}'),'확정','incomplete policy cannot be published');
select public.service_admin_action(:'org','settings.save',jsonb_build_object('revision',0,'content',jsonb_build_object(
 'operator_name','가상 시험 운영자','contact_email','service@example.invalid','privacy_contact','가상 담당자 service@example.invalid',
 'terms',repeat('격리 시험용 약관입니다. 운영 서비스에 적용하지 않습니다. ',4),
 'privacy',repeat('격리 시험용 개인정보 문구입니다. 실제 동의문이 아닙니다. ',4))));
select public.qa_denied(format('select public.service_admin_action(%L,%L,%L)',:'org','settings.save','{"revision":0,"content":{}}'),'변경','stale settings save is rejected');
select public.service_admin_action(:'org','settings.publish','{"revision":1,"confirm":"APPLY"}');
reset role;
select active_version_id as policy from private.service_settings where organization_id=:'org' \gset
set role anon;
select public.qa_assert((public.get_public_service_policy()->>'id')=:'policy','only explicitly published policy becomes public');
reset role;
set role authenticated;
select public.qa_assert((select count(*)=0 from public.plants),'publishing gates existing admin without fabricating consent');
select public.qa_denied(format('select public.service_admin_action(%L,%L)',:'org','customers.read'),'기본정보','admin cannot bypass consent through a definer customer RPC');
select public.qa_assert((public.service_admin_action(:'org','settings.read')->>'revision')::integer=2,'admin can still repair legal settings without lockout');
select public.qa_denied(format('select public.complete_service_profile(%L,%L,%L,false)',:'org','{"name":"가상 관리자","phone":"01012345678"}',:'policy'),'동의','unchecked consent is rejected');
select public.complete_service_profile(:'org','{"name":"가상 관리자","phone":"01012345678"}',:'policy',true);
select public.qa_assert((select count(*)=1 from public.plants),'admin regains business access after own explicit consent');
reset role;
select set_config('request.jwt.claim.sub',:'expert_id',false);
set role authenticated;
select public.qa_assert((select count(*)=0 from public.inspections),'assigned expert is blocked until own current consent');
select public.complete_service_profile(:'org','{"name":"가상 전문가","phone":"01012345678"}',:'policy',true);
select public.qa_assert((select count(*)=1 from public.inspections),'assigned expert regains only assigned work');
select public.qa_denied(format('select public.service_admin_action(%L,%L)',:'org','settings.read'),'관리자','expert cannot edit operator settings');
reset role;
select set_config('request.jwt.claim.sub',:'foreign_id',false);
set role authenticated;
select public.qa_assert((select count(*)=0 from public.inspections),'other workspace cannot read inspection');
select public.qa_denied(format('select public.get_service_onboarding(%L)',:'org'),'접근','other workspace cannot inspect profile or consent');
reset role;
update public.organization_members set status='suspended' where user_id=:'client_b';
select set_config('request.jwt.claim.sub',:'client_b',false);
set role authenticated;
select public.qa_denied('select public.register_requester()','중지','suspended client cannot self-reactivate');
reset role;
select set_config('request.jwt.claim.sub',:'owner_id',false);
set role authenticated;
select public.service_admin_action(:'org','customers.unlink_contact',jsonb_build_object('customer_id',:'customer','revision',5,'user_id',:'client_b'));
reset role;
select public.qa_assert(not(select active from private.customer_contacts where customer_id=:'customer' and user_id=:'client_b'),'administrator can detach a suspended contact');
select public.qa_assert((select count(*)=2 from private.service_consents),'only two explicit users have consent records');
select set_config('request.jwt.claim.sub','',false);
