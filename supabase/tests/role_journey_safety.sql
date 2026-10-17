-- Disposable local fixture only. No actual accounts or notifications.
begin;
reset role;
select id as owner from auth.users where email='service-owner@example.invalid' \gset
select id as expert from auth.users where email='service-expert@example.invalid' \gset
select id as client from auth.users where email='service-client-a@example.invalid' \gset
select id as org from public.organizations where slug='service-local-test' \gset
select id as plant from public.plants where organization_id=:'org' limit 1 \gset
select updated_at as old_member_version from public.organization_members where organization_id=:'org' and user_id=:'expert' \gset
select set_config('request.jwt.claim.sub',:'owner',true);
set local role authenticated;
select updated_at as suspended_version from public.admin_update_member(:'org',:'expert',null,'suspended',:'old_member_version') \gset
select public.qa_denied(format('select public.admin_update_member(%L,%L,%L,null,%L)',:'org',:'expert','client',:'old_member_version'),'변경','stale role edit cannot reactivate a suspended account');
select public.qa_assert((select role='expert' and status='suspended' from public.organization_members where organization_id=:'org' and user_id=:'expert'),'stale update changes neither field');
select public.admin_update_member(:'org',:'expert','client',null,:'suspended_version');
select public.qa_assert((select role='client' and status='suspended' from public.organization_members where organization_id=:'org' and user_id=:'expert'),'fresh role-only update preserves current suspension');
select public.qa_denied(format('select public.admin_update_member(%L,%L,%L,%L)',:'org',:'expert','client','active'),'새로고침','legacy four-argument API fails closed');
select updated_at as highest_version from public.organization_members where organization_id=:'org' and user_id=:'owner' \gset
select public.qa_denied(format('select public.admin_update_member(%L,%L,null,%L,%L)',:'org',:'owner','suspended',:'highest_version'),'최고 관리자','super admin remains protected');

reset role;
insert into public.inspections(organization_id,plant_id,inspection_code) values(:'org',:'plant','QA6-FAILED-ANALYSIS') returning id as inspection \gset
insert into public.inspection_files(organization_id,inspection_id,kind,storage_bucket,storage_path,original_name,mime_type,bytes,sha256,created_by)
 values(:'org',:'inspection','thermal_original','inspection-originals','qa6/local.jpg','가상 원본','image/jpeg',10,repeat('a',64),:'owner') returning id as file \gset
insert into public.report_images(id,organization_id,inspection_id,source_file_id,storage_path,sha256,bytes,width,height,caption,masks,status,created_by,reviewed_by,reviewed_at)
 values(gen_random_uuid(),:'org',:'inspection',:'file','qa6/report.jpg',repeat('b',64),10,10,10,'가상 승인 사진','[]','approved',:'owner',:'owner',now());
set local role authenticated;
select id as report from public.create_report_draft(:'inspection','QA6') \gset
select id as run from public.start_relative_analysis(:'file',64) \gset
select public.fail_relative_analysis(:'run','격리 분석 실패');
select public.qa_denied(format('select public.qa_transition_report(%L,%L,null)',:'report','review'),'실패·중단','failed analysis blocks report review');
select public.qa_denied(format('delete from public.analysis_runs where id=%L',:'run'),'permission denied','owner cannot erase failure evidence through direct API');
select public.qa_denied(format('select public.qa_transition_report(%L,%L,null)',:'report','review'),'실패·중단','failed analysis still blocks review after refused deletion');

reset role;
select set_config('request.jwt.claim.sub',:'client',true);
set local role authenticated;
select (public.get_service_onboarding(:'org')->'policy'->>'id')::uuid as policy \gset
select public.complete_service_profile(:'org','{"name":"가상 고객","phone":"01012345678","kind":"individual"}',:'policy',true);
select gen_random_uuid() as plant_key,gen_random_uuid() as request_key \gset
select id as p1 from public.create_requester_plant_with_details('QA6 repeated response','',null,null,'개인','','',true,:'plant_key') \gset
select id as p2 from public.create_requester_plant_with_details('QA6 repeated response','',null,null,'개인','','',true,:'plant_key') \gset
select public.qa_assert(:'p1'=:'p2','same requester plant request returns the original ID');
select public.qa_denied(format('select public.create_requester_plant_with_details(%L,%L,null,null,%L,%L,%L,true,%L)','different payload','','개인','','',:'plant_key'),'이미 등록','changed payload cannot reuse a successful registration receipt');
select id as p3 from public.create_requester_plant_with_details('QA6 repeated response','',null,null,'개인','','',true,gen_random_uuid()) \gset
select public.qa_assert(:'p1'<>:'p3','explicit new request may register a same-named plant');
select id as r1 from public.request_inspection(:'p1','QA6 same request','same notes',:'request_key') \gset
select id as r2 from public.request_inspection(:'p1','QA6 same request','same notes',:'request_key') \gset
select public.qa_assert(:'r1'=:'r2','same inspection request creates only one case');
select public.qa_denied(format('select public.request_inspection(%L,%L,%L,%L)',:'p1','different purpose','same notes',:'request_key'),'이미 접수','changed inspection payload cannot replace a receipt');
select public.qa_denied(format('select public.admin_update_member(%L,%L,null,%L,%L)',:'org',:'owner','suspended',:'highest_version'),'관리자만','requester cannot change administrator state');
select public.qa_denied('select * from private.intake_requests','permission denied','receipt storage is not directly exposed');
reset role;
delete from public.plant_requesters where plant_id=:'p1' and requester_user_id=:'client';
set local role authenticated;
select public.qa_denied(format('select public.request_inspection(%L,%L,%L,%L)',:'p1','QA6 same request','same notes',:'request_key'),'본인|연결','receipt replay cannot bypass revoked plant access');
reset role;
rollback;
