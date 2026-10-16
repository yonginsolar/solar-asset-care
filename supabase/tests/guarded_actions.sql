-- Isolated fixture only, included before workflow_integrity.sql in photo fixture.
reset role;
select set_config('request.jwt.claim.sub',:'owner',true);
insert into public.inspections(organization_id,plant_id,inspection_code,assigned_expert_user_id)
 values(:'org',:'plant','GUARDED-ACTIONS',:'expert') returning id as g_inspection \gset
insert into public.inspection_files(organization_id,inspection_id,kind,storage_bucket,storage_path,original_name,mime_type,bytes,sha256,created_by)
 values(:'org',:'g_inspection','thermal_original','inspection-originals','guarded/a.jpg','격리 사진.jpg','image/jpeg',8,repeat('a',64),:'owner') returning id as g_file \gset
insert into public.report_images(id,organization_id,inspection_id,source_file_id,storage_path,sha256,bytes,width,height,caption,masks,status,created_by,reviewed_by,reviewed_at)
 values(gen_random_uuid(),:'org',:'g_inspection',:'g_file','guarded/report.jpg',repeat('b',64),100,100,100,'가상 사진','[]','approved',:'expert',:'owner',now());
set local role authenticated;
select id as g_report from public.create_report_draft(:'g_inspection','수정판 검증') \gset
select public.qa_transition_report(:'g_report','review',null);
select action_revision as g_rev from public.reports where id=:'g_report' \gset
select sha256 as g_hash from public.report_snapshots where report_id=:'g_report' \gset
select public.qa_denied(format('select public.transition_report_status(%L,%L,null)',:'g_report','approved'),'변경','old report call cannot bypass revision checks');
select public.qa_transition_report(:'g_report','draft','내용 보완');
insert into public.findings(organization_id,inspection_id,source,kind,disposition,expert_note) values(:'org',:'g_inspection','expert_manual','hotspot','accepted','다른 검토본 소견');
select public.qa_transition_report(:'g_report','review',null);
select public.qa_assert((select sha256<>:'g_hash' from public.report_snapshots where report_id=:'g_report'),'new review content has a different snapshot identity');
select public.qa_denied(format('select public.transition_report_status(%L,%L,null,%L,%L)',:'g_report','approved',:'g_rev',:'g_hash'),'변경','stale approval cannot approve changed review content');
select public.qa_assert((select status='review' from public.reports where id=:'g_report'),'rejected approval leaves review intact');
select set_config('request.jwt.claim.sub',:'expert',true);
select public.qa_denied(format('select public.qa_transition_report(%L,%L,null)',:'g_report','approved'),'관리자','expert approval remains denied');
select set_config('request.jwt.claim.sub',:'owner',true);
select public.qa_transition_report(:'g_report','approved',null);
select public.qa_transition_report(:'g_report','draft','분석 시험');
select id as g_run from public.start_relative_analysis(:'g_file',64) \gset
select public.qa_denied(format('select public.start_relative_analysis(%L,64)',:'g_file'),'분석 중','duplicate running analysis blocked');
select public.qa_denied(format('select public.qa_transition_report(%L,%L,null)',:'g_report','review'),'분석이 아직','review waits for active analysis');
select public.qa_denied(format('select public.complete_relative_analysis(%L,null,null)',:'g_run'),'형식','SQL NULL cannot become a successful empty analysis');
select public.qa_assert((select status='running' from public.analysis_runs where id=:'g_run'),'invalid completion leaves job recoverable');
select public.resolve_relative_analysis(:'g_run','running','cancel','격리 중단 확인');
select public.qa_denied(format('select public.qa_transition_report(%L,%L,null)',:'g_report','review'),'실패·중단','cancel is not silently interpreted as reviewed');
select public.resolve_relative_analysis(:'g_run','cancelled','manual_review','원본을 직접 확인하고 자동 결과를 사용하지 않음');
select public.resolve_relative_analysis(:'g_run','cancelled','manual_review','동일 확인 요청 재전송');
select public.qa_assert((select count(*)=1 from public.audit_events where entity_id=:'g_run' and action='analysis.relative_resolved' and metadata->>'action'='manual_review'),'manual acknowledgment replay preserves the first evidence and single audit event');
select public.qa_transition_report(:'g_report','review',null);
select public.qa_denied(format('select public.start_relative_analysis(%L,64)',:'g_file'),'검토 중','no new analysis while review snapshot is active');
select public.qa_transition_report(:'g_report','draft','재실행 시험');
select id as g_run2 from public.start_relative_analysis(:'g_file',64) \gset
select public.fail_relative_analysis(:'g_run2','일시 연결 실패');
select public.qa_denied(format('select public.qa_transition_report(%L,%L,null)',:'g_report','review'),'실패·중단','a failed requested analysis needs retry or explicit manual review');
select id as g_run3 from public.start_relative_analysis(:'g_file',64) \gset
reset role;
update public.analysis_runs set started_at=clock_timestamp()-interval '11 minutes' where id=:'g_run3';
set local role authenticated;
select public.qa_denied(format('select public.complete_relative_analysis(%L,%L::jsonb,%L::jsonb)',:'g_run3','{}','[]'),'만료','late result cannot complete an expired lease');
select id as g_run4 from public.start_relative_analysis(:'g_file',64) \gset
select public.qa_assert((select status='failed' and error_code='RELATIVE_ANALYSIS_EXPIRED' from public.analysis_runs where id=:'g_run3'),'explicit retry expires a stale running job instead of duplicating it');
select public.complete_relative_analysis(:'g_run4','{"quality":"uniform"}','[]');
select public.qa_transition_report(:'g_report','review',null);
select public.qa_assert((select reviewed_at is null from public.analysis_runs where id=:'g_run2'),'later success resolves older failure without fabricating an acknowledgment');

-- Atomic administrator creation/link, stable replay identity and exact edit CAS.
select gen_random_uuid() as g_plant_id \gset
select public.qa_denied(format('select public.save_admin_plant(%L,%L,null,%L::jsonb,%L)',:'org',:'g_plant_id','{"name":"실패할 새 자산","data_use_consent":true}',:'foreign_user'),'활성 의뢰인','failed client link rolls back new plant');
select public.qa_assert((select count(*)=0 from public.plants where id=:'g_plant_id'),'no partial plant left after failed linking');
select public.save_admin_plant(:'org',:'g_plant_id',null,'{"name":"격리 새 자산","data_use_consent":true}',:'client');
select public.save_admin_plant(:'org',:'g_plant_id',null,'{"name":"격리 새 자산","data_use_consent":true}',:'client');
select public.qa_assert((select count(*)=1 from public.plants where id=:'g_plant_id'),'unknown-response replay creates exactly one plant');
select public.qa_assert((select count(*)=1 from public.plant_requesters where plant_id=:'g_plant_id' and requester_user_id=:'client'),'creation and requester link both committed once');
select public.qa_denied(format('select public.save_admin_plant(%L,%L,null,%L::jsonb,%L)',:'org',:'g_plant_id','{"name":"다른 등록 요청","data_use_consent":true}',:'client'),'다른 등록','same creation ID cannot be reused with changed input');
select public.qa_denied(format('select public.save_admin_plant(%L,%L,%L,%L::jsonb,null)',:'org',:'g_plant_id','2000-01-01','{"name":"오래된 수정"}'),'변경','stale admin edit rejected');
select public.qa_assert((select name='격리 새 자산' from public.plants where id=:'g_plant_id'),'stale admin edit preserves current plant');
select updated_at as g_plant_updated,metadata->>'data_use_consent_at' as g_consent_at from public.plants where id=:'g_plant_id' \gset
select public.save_admin_plant(:'org',:'g_plant_id',:'g_plant_updated','{"name":"격리 수정 완료","data_use_consent":true}',null);
select public.qa_assert((select name='격리 수정 완료' and metadata->>'data_use_consent_at'=:'g_consent_at' and metadata ? 'registration_hash' from public.plants where id=:'g_plant_id'),'fresh admin edit preserves original consent and creation identity');
reset role;
insert into public.plants(organization_id,name,metadata) values(:'org','기존 동의 미기록','{"unrelated":"keep"}') returning id as g_legacy,updated_at as g_legacy_updated \gset
set local role authenticated;
select public.qa_denied(format('select public.save_admin_plant(%L,%L,%L,%L::jsonb,null)',:'org',:'g_legacy',:'g_legacy_updated','{"name":"동의 없는 수정"}'),'동의','missing historical consent is not fabricated by an administrator edit');
select public.save_admin_plant(:'org',:'g_legacy',:'g_legacy_updated','{"name":"명시 동의로 보완","data_use_consent":true}',null);
select public.qa_assert((select metadata->>'unrelated'='keep' and metadata ? 'data_use_consent_at' from public.plants where id=:'g_legacy'),'explicit admin edit consent is captured while unrelated metadata is preserved');
select set_config('request.jwt.claim.sub',:'client',true);
select public.qa_denied(format('select public.save_admin_plant(%L,%L,null,%L::jsonb,null)',:'org',:'g_plant_id','{"name":"고객 우회"}'),'관리자','customer keeps narrow requester RPC only');
select set_config('request.jwt.claim.sub',:'foreign_user',true);
select public.qa_denied(format('select public.resolve_relative_analysis(%L,%L,%L,%L)',:'g_run','cancelled','manual_review','타 조직'),'권한','foreign user cannot acknowledge analysis');
reset role;
select set_config('request.jwt.claim.sub',:'owner',true);
set local role authenticated;
select public.complete_service_profile(:'org','{"name":"격리 관리자","phone":"01012345678","kind":"individual"}',null,false);
reset role;
insert into public.partners(organization_id,name,partner_type) values(:'org','가상 비교 A','maintenance') returning id as g_pa \gset
insert into public.partners(organization_id,name,partner_type) values(:'org','가상 비교 B','maintenance') returning id as g_pb \gset
insert into public.partners(organization_id,name,partner_type) values(:'org','가상 비교 C','maintenance') returning id as g_pc \gset
select set_config('request.jwt.claim.sub',:'owner',true);
set local role authenticated;
select id as g_qr from public.create_quote_request_with_partners(:'plant',:'client','변경 비교','격리',null,array[:'g_pa'::uuid,:'g_pb'::uuid,:'g_pc'::uuid],null,null,0) \gset
select id as g_q from public.partner_quotes where quote_request_id=:'g_qr' and partner_id=:'g_pa' \gset
select public.record_partner_quote_response(:'g_q',100000,1,null,null,'범위 A','조건 A',0);
select action_revision as g_q_rev from public.partner_quotes where id=:'g_q' \gset
select action_revision as g_qr_rev from public.quote_requests where id=:'g_qr' \gset
select public.record_partner_quote_response(:'g_q',900000,9,null,null,'범위 B','조건 B',0);
select set_config('request.jwt.claim.sub',:'client',true);
select public.qa_denied(format('select public.select_partner_quote(%L,%L,%L)',:'g_q',:'g_q_rev',:'g_qr_rev'),'변경','old customer comparison cannot select changed amount or conditions');
select public.qa_denied(format('select public.select_partner_quote(%L)',:'g_q'),'변경','legacy selection cannot bypass exact revision');
select public.qa_select_quote(:'g_q');
select public.qa_assert((select status='selected' and amount_krw=900000 from public.partner_quotes where id=:'g_q'),'fresh comparison can still select a valid quote');
select set_config('request.jwt.claim.sub',:'owner',true);
select id as g_qr2 from public.create_quote_request_with_partners(:'plant',:'client','만료 비교','격리',null,array[:'g_pa'::uuid,:'g_pb'::uuid,:'g_pc'::uuid],null,null,0) \gset
select id as g_expired from public.partner_quotes where quote_request_id=:'g_qr2' and partner_id=:'g_pa' \gset
select public.record_partner_quote_response(:'g_expired',100000,1,null,current_date-1,'만료 범위','만료 조건',0);
select set_config('request.jwt.claim.sub',:'client',true);
select public.qa_denied(format('select public.qa_select_quote(%L)',:'g_expired'),'유효기간','expired quote cannot be selected');
reset role;
select set_config('request.jwt.claim.sub',:'owner',true);
\echo PASS guarded report/analysis/quote/plant actions and existing role boundaries
