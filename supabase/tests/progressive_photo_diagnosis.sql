-- Isolated local fixture only. All writes are rolled back; never send mail.
begin;
insert into auth.users(email,email_confirmed_at,encrypted_password) values('photo-owner@example.invalid',now(),'synthetic') returning id as owner \gset
insert into auth.users(email,email_confirmed_at,encrypted_password) values('photo-expert@example.invalid',now(),'synthetic') returning id as expert \gset
insert into auth.users(email,email_confirmed_at,encrypted_password) values('photo-client@example.invalid',now(),'synthetic') returning id as client \gset
insert into auth.users(email,email_confirmed_at,encrypted_password) values('photo-other@example.invalid',now(),'synthetic') returning id as other \gset
insert into auth.users(email,email_confirmed_at,encrypted_password) values('photo-foreign@example.invalid',now(),'synthetic') returning id as foreign_user \gset
insert into public.organizations(name,slug) values('사진 진단 격리 시험','photo-progressive-local') returning id as org \gset
insert into public.organizations(name,slug) values('사진 타 조직','photo-progressive-foreign') returning id as foreign_org \gset
insert into public.organization_members(organization_id,user_id,role,status) values
 (:'org',:'owner','owner','active'),(:'org',:'expert','expert','active'),(:'org',:'client','client','active'),
 (:'org',:'other','client','active'),(:'foreign_org',:'foreign_user','client','active');
select set_config('request.jwt.claim.sub',:'client',true);
set local role authenticated;
select public.complete_service_profile(:'org','{"name":"가상 담당자","phone":"01012345678","kind":"corporation","business_name":"시험 사업자","business_number":"1234567891"}',null,false);
select id as plant,updated_at as edited from public.create_requester_plant_with_details('사진만 접수','',null,null,'개인','','',true) \gset
select public.qa_assert((select capacity_kw is null and commissioned_on is null from public.plants where id=:'plant'),'photo intake accepts unknown capacity and commissioning date');
select public.update_requester_plant(:'plant',:'edited','사진 진단 발전소','추후 확인',null,null,'개인','','');
select public.qa_denied(format('select public.update_requester_plant(%L,%L,%L,%L,null,null,%L,%L,%L)',:'plant','2000-01-01','오래된 초안','','개인','',''),'변경','stale plant edit rejected');
select public.qa_denied(format('select public.update_requester_plant(%L,%L,%L,%L,-1,null,%L,%L,%L)',:'plant',:'edited','잘못된 용량','','개인','',''),'입력 범위','invalid capacity rejected');
reset role;
select public.qa_assert((select metadata->>'data_use_consent_version'='operational-registration-v1' from public.plants where id=:'plant'),'plant edit preserves existing data consent');
select set_config('request.jwt.claim.sub',:'other',true);
set local role authenticated;
select public.complete_service_profile(:'org','{"name":"동일 사업자 담당자","phone":"01012345679","kind":"corporation","business_name":"시험 사업자","business_number":"1234567891"}',null,false);
select public.qa_assert((select count(*)=0 from public.plants),'same business number does not auto-grant access');
select public.qa_denied(format('select public.update_requester_plant(%L,%L,%L,%L,null,null,%L,%L,%L)',:'plant',:'edited','타 고객 수정','','개인','',''),'권한','unlinked customer edit rejected');
reset role;
select set_config('request.jwt.claim.sub',:'owner',true);
set local role authenticated;
select public.service_admin_action(:'org','customers.create','{"kind":"corporation","name":"시험 사업자","business_number":"1234567891"}');
reset role;
select id as customer from private.customer_accounts where organization_id=:'org' \gset
set local role authenticated;
select public.service_admin_action(:'org','customers.link_contact',jsonb_build_object('customer_id',:'customer','revision',1,'user_id',:'other'));
select public.service_admin_action(:'org','customers.link_plant',jsonb_build_object('customer_id',:'customer','revision',2,'plant_id',:'plant'));
reset role;
select set_config('request.jwt.claim.sub',:'other',true);
set local role authenticated;
select public.update_requester_plant(:'plant',:'edited','공유 담당자 보완','자료 확인 중',null,null,'개인','','');
reset role;
select set_config('request.jwt.claim.sub',:'owner',true);
set local role authenticated;
select public.service_admin_action(:'org','customers.unlink_contact',jsonb_build_object('customer_id',:'customer','revision',3,'user_id',:'other'));
reset role;
select set_config('request.jwt.claim.sub',:'other',true);
set local role authenticated;
select public.qa_denied(format('select public.update_requester_plant(%L,%L,%L,%L,null,null,%L,%L,%L)',:'plant',:'edited','회수 후 수정','','개인','',''),'권한','revoked contact edit rejected');
reset role;
select set_config('request.jwt.claim.sub',:'owner',true);
insert into public.inspections(organization_id,plant_id,inspection_code,assigned_expert_user_id,created_by)
 values(:'org',:'plant','PHOTO-ONLY',:'expert',:'owner') returning id as inspection \gset
insert into public.inspection_files(organization_id,inspection_id,kind,storage_bucket,storage_path,original_name,mime_type,bytes,sha256,created_by)
 values(:'org',:'inspection','thermal_original','inspection-originals','photo-local/test.jpg','가상 열화상.jpg','image/jpeg',100,repeat('a',64),:'owner') returning id as source \gset
select set_config('request.jwt.claim.sub',:'expert',true);
set local role authenticated;
select public.qa_denied(format('select public.update_requester_plant(%L,%L,%L,%L,null,null,%L,%L,%L)',:'plant',:'edited','전문가 수정','','개인','',''),'권한','expert does not gain plant editing rights');
select id as report from public.create_report_draft(:'inspection','사진 진단 보고서') \gset
select public.qa_denied(format('select public.qa_transition_report(%L,%L,null)',:'report','review'),'승인한 보고서 사진','photo-only review requires approved evidence');
reset role;
insert into public.report_images(id,organization_id,inspection_id,source_file_id,storage_path,sha256,bytes,width,height,caption,masks,status,created_by,reviewed_by,reviewed_at)
 values(gen_random_uuid(),:'org',:'inspection',:'source','photo-local/approved.jpg',repeat('b',64),100,100,100,'가상 승인 사진','[]','approved',:'expert',:'owner',now());
select set_config('request.jwt.claim.sub',:'expert',true);
set local role authenticated;
select public.qa_transition_report(:'report','review',null);
select public.qa_assert((select content->>'schemaVersion'='2' and content->>'diagnosisMode'='photo-only' and content->'assessment'='null'::jsonb and content->'settings'='null'::jsonb from public.report_snapshots where report_id=:'report'),'photo-only snapshot has no invented financial or capture data');
select public.qa_denied(format('select public.qa_transition_report(%L,%L,null)',:'report','approved'),'관리자','expert still cannot approve');
select sha256 as frozen_hash from public.report_snapshots where report_id=:'report' \gset
reset role;
select set_config('request.jwt.claim.sub',:'owner',true);
set local role authenticated;
select public.qa_transition_report(:'report','approved',null);
select public.qa_denied(format('select public.qa_transition_report(%L,%L,null)',:'report','published'),'PDF','photo-only publication still requires immutable PDF archive');
reset role;
select set_config('request.jwt.claim.sub',:'client',true);
set local role authenticated;
select public.qa_assert((select count(*)=0 from public.reports where id=:'report'),'customer cannot see unissued photo report');
select public.update_requester_plant(:'plant',:'edited','발전소 정보 보완','새 주소',100,'2020-01-01','개인','','');
reset role;
select public.qa_assert((select sha256=:'frozen_hash' and content->'plant'->>'name'='공유 담당자 보완' from public.report_snapshots where report_id=:'report'),'plant edits never rewrite approved photo snapshot');
select set_config('request.jwt.claim.sub',:'foreign_user',true);
set local role authenticated;
select public.complete_service_profile(:'foreign_org','{"name":"타 조직","phone":"01012345678","kind":"individual"}',null,false);
select public.qa_denied(format('select public.update_requester_plant(%L,%L,%L,%L,null,null,%L,%L,%L)',:'plant',:'edited','타 조직 수정','','개인','',''),'권한','cross-organization plant edit rejected');
reset role;
set local role anon;
select public.qa_denied(format('select public.update_requester_plant(%L,%L,%L,%L,null,null,%L,%L,%L)',:'plant',:'edited','익명 수정','','개인','',''),'permission denied','anonymous RPC denied');
reset role;
rollback;
