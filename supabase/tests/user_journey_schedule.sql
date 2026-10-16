-- Runs after workflow_integrity in the same isolated, rolled-back transaction.
select set_config('request.jwt.claim.sub',:'owner',true);
set local role authenticated;
select updated_at as schedule_revision from public.inspections where id=:'inspection' \gset
select public.update_inspection_schedule(:'inspection',:'schedule_revision','2026-10-20 10:30+09','2026-10-21 18:00+09');
select public.qa_assert((select scheduled_at='2026-10-20 01:30+00' and due_at='2026-10-21 09:00+00' and status='published' from public.inspections where id=:'inspection'),'admin can add schedule to existing request without fabricating work status');
select public.qa_assert((select count(*)=1 from public.audit_events where entity_id=:'inspection' and action='inspection.schedule_updated'),'date changes are audited without granting client audit inserts');
select public.qa_denied(format('select public.update_inspection_schedule(%L,%L,null,null)',:'inspection','2000-01-01'),'변경','stale schedule revision rejected');
select public.qa_denied(format('select public.update_inspection_schedule(%L,%L,%L,%L)',:'inspection',:'schedule_revision','2026-10-22','2026-10-21'),'완료 목표','invalid date order rejected');
select public.qa_denied(format('select public.update_inspection_schedule(%L,%L,%L,null)',:'inspection',:'schedule_revision','infinity'),'날짜','infinite timestamp rejected');
select public.qa_denied(format('update public.inspections set due_at=%L where id=%L','2026-10-19',:'inspection'),'완료 목표','direct table update cannot bypass date validation');
select public.update_inspection_schedule(:'inspection',:'schedule_revision',null,null);
select public.qa_assert((select scheduled_at is null and due_at is null from public.inspections where id=:'inspection'),'admin may clear optional schedules');
select set_config('request.jwt.claim.sub',:'expert',true);
select public.qa_denied(format('select public.update_inspection_schedule(%L,%L,null,null)',:'inspection',:'schedule_revision'),'관리자','assigned expert cannot change schedule');
select set_config('request.jwt.claim.sub',:'client',true);
select public.qa_denied(format('select public.update_inspection_schedule(%L,%L,null,null)',:'inspection',:'schedule_revision'),'관리자','customer cannot change schedule');
select set_config('request.jwt.claim.sub',:'foreign_user',true);
select public.qa_denied(format('select public.update_inspection_schedule(%L,%L,null,null)',:'inspection',:'schedule_revision'),'관리자','foreign member cannot change schedule');
select set_config('request.jwt.claim.sub',:'owner',true);
update public.inspections set status='closed' where id=:'inspection';
select public.qa_denied(format('select public.update_inspection_schedule(%L,%L,%L,null)',:'inspection',:'schedule_revision','2026-10-20'),'종료','closed inspection schedule remains locked');
select public.qa_denied(format('update public.inspections set scheduled_at=%L where id=%L','2026-10-20',:'inspection'),'종료','closed schedule also locked through direct table API');
select public.qa_assert((select sha256=:'frozen_hash' from public.report_snapshots where report_id=:'report'),'schedule editing never rewrites issued snapshots');
reset role;
set local role anon;
select public.qa_denied(format('select public.update_inspection_schedule(%L,%L,null,null)',:'inspection',:'schedule_revision'),'permission denied','anonymous schedule RPC denied');
reset role;
