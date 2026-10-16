-- Included inside progressive_photo_diagnosis's isolated transaction.
select set_config('request.jwt.claim.sub',:'owner',true);
set local role authenticated;
select public.qa_denied(format('update public.inspections set status=%L where id=%L','published',:'inspection'),'발행|보고서','cannot manually publish an inspection without an issued report');
select public.qa_denied(format('update public.inspections set status=%L where id=%L','closed',:'inspection'),'발행','cannot close an unfinished report');
select public.qa_denied(format('select public.create_report_draft(%L,%L)',:'inspection','중복'),'작성·검토','duplicate active report blocked');
reset role;
insert into storage.objects(bucket_id,name,metadata)
 select 'reports',organization_id::text||'/'||inspection_id::text||'/'||id::text||'/'||:'frozen_hash'||'.pdf','{"size":100,"mimetype":"application/pdf"}'::jsonb from public.reports where id=:'report';
set local role authenticated;
select public.archive_report_pdf(:'report',:'frozen_hash',repeat('d',64),100,'text-assessment-v1');
select public.qa_transition_report(:'report','published',null);
select set_config('request.jwt.claim.sub',:'expert',true);
insert into public.findings(organization_id,inspection_id,source,kind,disposition,expert_note,reviewed_by,reviewed_at)
 values(:'org',:'inspection','expert_manual','hotspot','accepted','UNPUBLISHED-NEW-FINDING',:'expert',now()) returning id as new_finding \gset
select set_config('request.jwt.claim.sub',:'client',true);
select public.qa_assert((select count(*)=0 from public.findings where inspection_id=:'inspection'),'customer cannot read mutable findings after publication');
select public.qa_assert((select count(*)=1 from public.report_snapshots where report_id=:'report'),'customer retains frozen issued report');
reset role;
select set_config('request.jwt.claim.sub',:'owner',true);
set local role authenticated;
select id as report2 from public.create_report_draft(:'inspection','개정 보고서 시험') \gset
select public.qa_assert((select status='expert_review' from public.inspections where id=:'inspection'),'new revision updates work status but keeps old issue available');
select public.qa_transition_report(:'report2','review',null);
select public.qa_transition_report(:'report2','approved',null);
select public.qa_denied(format('select public.qa_transition_report(%L,%L,null)',:'report2','published'),'PDF','failed revision publication still requires PDF');
select public.qa_assert((select status='published' from public.reports where id=:'report'),'failed replacement retains current published report');
reset role;
select sha256 as hash2 from public.report_snapshots where report_id=:'report2' \gset
insert into storage.objects(bucket_id,name,metadata)
 select 'reports',organization_id::text||'/'||inspection_id::text||'/'||id::text||'/'||:'hash2'||'.pdf','{"size":100,"mimetype":"application/pdf"}'::jsonb from public.reports where id=:'report2';
set local role authenticated;
select public.archive_report_pdf(:'report2',:'hash2',repeat('e',64),100,'text-assessment-v1');
select public.qa_transition_report(:'report2','published',null);
select public.qa_assert((select count(*)=1 from public.reports where inspection_id=:'inspection' and status='published'),'atomic revision leaves exactly one current issue');
select public.qa_assert((select status='withdrawn' from public.reports where id=:'report'),'previous issue superseded without deletion');
reset role;
select public.qa_assert((select sha256=:'frozen_hash' from public.report_snapshots where report_id=:'report'),'previous snapshot hash unchanged');
select public.qa_assert((select count(*)=2 from public.report_documents where report_id in (:'report',:'report2')),'both immutable PDF archives retained');
select set_config('request.jwt.claim.sub',:'owner',true);
set local role authenticated;
update public.inspections set status='closed' where id=:'inspection';
select updated_at as closed_at from public.inspections where id=:'inspection' \gset
select public.qa_denied(format('select public.create_report_draft(%L,%L)',:'inspection','종료 후 보완'),'종료','closed inspection rejects new draft');
select public.qa_denied(format('update public.findings set expert_note=%L where id=%L','종료 수정',:'new_finding'),'종료','closed inspection rejects evidence edits');
select public.qa_denied(format('select public.reopen_inspection(%L,%L,%L)',:'inspection','2000-01-01','재개'),'변경','stale reopening rejected');
select set_config('request.jwt.claim.sub',:'expert',true);
select public.qa_denied(format('select public.reopen_inspection(%L,%L,%L)',:'inspection',:'closed_at','재개'),'관리자','expert cannot reopen a closed inspection');
select set_config('request.jwt.claim.sub',:'owner',true);
select public.qa_denied(format('select public.reopen_inspection(%L,%L,%L)',:'inspection',:'closed_at',''),'사유','reopening needs a reason');
select public.reopen_inspection(:'inspection',:'closed_at','경제성 자료 보완');
select public.qa_assert((select status='published' from public.inspections where id=:'inspection'),'reopened inspection retains current issue state');
select public.service_admin_action(:'org','customers.link_contact',jsonb_build_object('customer_id',:'customer','revision',4,'user_id',:'other'));
select public.qa_assert(exists(select 1 from public.get_quote_requesters(:'org') where plant_id=:'plant' and requester_user_id=:'other'),'approved shared customer contact is eligible for quote designation');
insert into public.maintenance_requests(organization_id,inspection_id,title,created_by) values(:'org',:'inspection','격리 작업',:'owner') returning id as maintenance \gset
reset role;
insert into public.partners(organization_id,name,partner_type) values(:'org','시험 업체1','maintenance') returning id as p1 \gset
insert into public.partners(organization_id,name,partner_type) values(:'org','시험 업체2','maintenance') returning id as p2 \gset
insert into public.partners(organization_id,name,partner_type) values(:'org','시험 업체3','maintenance') returning id as p3 \gset
set local role authenticated;
select id as request from public.create_quote_request_with_partners(:'plant',:'other','격리 견적','시험',null,array[:'p1'::uuid,:'p2'::uuid,:'p3'::uuid],:'inspection',:'maintenance',0) \gset
select id as q1 from public.partner_quotes where quote_request_id=:'request' and partner_id=:'p1' \gset
select id as q2 from public.partner_quotes where quote_request_id=:'request' and partner_id=:'p2' \gset
select public.record_partner_quote_response(:'q1',100000,1,null,null,'작업','',0);
select public.record_partner_quote_response(:'q2',200000,2,null,null,'작업','',0);
select set_config('request.jwt.claim.sub',:'client',true);
select public.qa_denied(format('select public.qa_select_quote(%L)',:'q1'),'권한','other authorized plant customer cannot choose designated contacts quote');
select set_config('request.jwt.claim.sub',:'other',true);
select public.qa_select_quote(:'q1');
select public.qa_assert((select selected_quote_id=:'q1' and vendor_name='시험 업체1' and status='assigned' from public.maintenance_requests where id=:'maintenance'),'selected quotation populates linked maintenance vendor');
select set_config('request.jwt.claim.sub',:'owner',true);
select public.qa_denied(format('update public.maintenance_requests set vendor_name=%L where id=%L','다른 업체',:'maintenance'),'일치','cannot overwrite linked selected vendor with unrelated name');
update public.maintenance_requests set status='completed' where id=:'maintenance';
select public.qa_assert((select completed_at is not null from public.maintenance_requests where id=:'maintenance'),'completion uses server timestamp');
select public.qa_denied(format('select public.qa_select_quote(%L)',:'q2'),'작업 중','completed work blocks vendor reselection atomically');
select public.qa_assert((select selected_quote_id=:'q1' from public.quote_requests where id=:'request'),'failed reselection retains old quote');
update public.maintenance_requests set status='in_progress' where id=:'maintenance';
select public.qa_assert((select completed_at is null from public.maintenance_requests where id=:'maintenance'),'reopening maintenance clears stale completion timestamp');
select public.service_admin_action(:'org','customers.unlink_contact',jsonb_build_object('customer_id',:'customer','revision',5,'user_id',:'other'));
select set_config('request.jwt.claim.sub',:'other',true);
select public.qa_assert((select count(*)=0 from public.quote_requests where id=:'request'),'revoked shared contact immediately loses quotation access');
select public.qa_denied(format('select public.qa_select_quote(%L)',:'q1'),'권한','revoked contact cannot select using old session');
reset role;
