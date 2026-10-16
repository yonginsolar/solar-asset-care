-- ONLY the ephemeral local fixture database. Each statement autocommits so
-- updated_at reflects separate client transactions, unlike one BEGIN block.
insert into auth.users(email,email_confirmed_at,encrypted_password) values('revision-owner@example.invalid',now(),'synthetic') returning id as owner \gset
insert into auth.users(email,email_confirmed_at,encrypted_password) values('revision-expert-a@example.invalid',now(),'synthetic') returning id as expert_a \gset
insert into auth.users(email,email_confirmed_at,encrypted_password) values('revision-expert-b@example.invalid',now(),'synthetic') returning id as expert_b \gset
insert into auth.users(email,email_confirmed_at,encrypted_password) values('revision-client@example.invalid',now(),'synthetic') returning id as client \gset
insert into auth.users(email,email_confirmed_at,encrypted_password) values('revision-foreign@example.invalid',now(),'synthetic') returning id as foreign_owner \gset
insert into public.organizations(name,slug) values('격리 수정판 시험','local-revision-test') returning id as org \gset
insert into public.organizations(name,slug) values('격리 타 조직','local-revision-foreign') returning id as foreign_org \gset
insert into public.organization_members(organization_id,user_id,role,status) values
 (:'org',:'owner','owner','active'),(:'org',:'expert_a','expert','active'),(:'org',:'expert_b','expert','active'),(:'org',:'client','client','active'),(:'foreign_org',:'foreign_owner','owner','active');
insert into public.plants(organization_id,name) values(:'org','격리 발전소') returning id as plant \gset
insert into public.inspections(organization_id,plant_id,inspection_code,assigned_expert_user_id)
 values(:'org',:'plant','LOCAL-REVISION',:'expert_a') returning id as inspection,updated_at as original_revision \gset
select set_config('request.jwt.claim.sub',:'owner',false);
set role authenticated;
update public.inspections set assigned_expert_user_id=:'expert_b'
 where id=:'inspection' and organization_id=:'org' and updated_at=:'original_revision' returning updated_at as next_revision \gset
select public.qa_assert(:'next_revision'::timestamptz<>:'original_revision'::timestamptz,'separate transactions produce a newer inspection revision');
with changed as (update public.inspections set assigned_expert_user_id=:'expert_a'
 where id=:'inspection' and organization_id=:'org' and updated_at=:'original_revision' returning id)
 select public.qa_assert(count(*)=0,'stale assignment changes zero rows, not the newer expert') from changed;
with changed as (update public.inspections set status='scheduled'
 where id=:'inspection' and organization_id=:'org' and updated_at=:'original_revision' returning id)
 select public.qa_assert(count(*)=0,'stale inspection state changes zero rows') from changed;
select public.qa_assert((select assigned_expert_user_id=:'expert_b' and status='requested' from public.inspections where id=:'inspection'),'stale edits preserve both assignment and status');
with changed as (update public.inspections set status='quality_review'
 where id=:'inspection' and organization_id=:'org' and updated_at=:'next_revision' returning id)
 select public.qa_assert(count(*)=1,'fresh owner state update returns exactly one row') from changed;
select updated_at as current_revision from public.inspections where id=:'inspection' \gset
insert into public.maintenance_requests(organization_id,inspection_id,title,created_by)
 values(:'org',:'inspection','격리 조치',:'owner') returning id as maintenance,updated_at as original_work_revision \gset
update public.maintenance_requests set status='completed' where id=:'maintenance' and organization_id=:'org' and updated_at=:'original_work_revision'
 returning updated_at as completed_revision \gset
with changed as (update public.maintenance_requests set status='in_progress' where id=:'maintenance' and organization_id=:'org' and updated_at=:'original_work_revision' returning id)
 select public.qa_assert(count(*)=0,'stale maintenance state cannot reopen completed work') from changed;
select public.qa_assert((select status='completed' and completed_at is not null from public.maintenance_requests where id=:'maintenance'),'completion timestamp survives stale request');
with changed as (update public.maintenance_requests set status='in_progress' where id=:'maintenance' and organization_id=:'org' and updated_at=:'completed_revision' returning id)
 select public.qa_assert(count(*)=1,'explicit fresh maintenance reopen remains available') from changed;
select public.qa_assert((select completed_at is null from public.maintenance_requests where id=:'maintenance'),'fresh reopen still clears completion as designed');
reset role;
select set_config('request.jwt.claim.sub',:'foreign_owner',false);
set role authenticated;
with changed as (update public.inspections set status='scheduled' where id=:'inspection' and updated_at=:'current_revision' returning id)
 select public.qa_assert(count(*)=0,'foreign owner stays blocked even with exact known revision') from changed;
reset role;
select set_config('request.jwt.claim.sub',:'client',false);
set role authenticated;
with changed as (update public.inspections set status='scheduled' where id=:'inspection' and updated_at=:'current_revision' returning id)
 select public.qa_assert(count(*)=0,'client does not gain inspection write authority') from changed;
reset role;
select set_config('request.jwt.claim.sub',:'expert_b',false);
set role authenticated;
with changed as (update public.maintenance_requests set status='completed' where id=:'maintenance' returning id)
 select public.qa_assert(count(*)=0,'expert does not gain maintenance write authority') from changed;
select public.qa_denied(format('update public.inspections set assigned_expert_user_id=%L where id=%L and updated_at=%L',:'expert_a',:'inspection',:'current_revision'),'관리자|담당|변경','expert cannot reassign even with exact revision');
reset role;
select set_config('request.jwt.claim.sub','',false);
\echo PASS local optimistic assignment/status/maintenance and role boundaries
