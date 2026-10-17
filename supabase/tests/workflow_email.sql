-- Included in progressive_photo_diagnosis's LOCAL transaction, after workflow_integrity.
-- No Edge/provider requests. local.fixture addresses exist only in the disposable DB.
reset role;
-- Focus queue consumption on this case; other suites' disposable case is separate.
delete from private.workflow_emails where inspection_id<>:'inspection';
select public.qa_assert((select count(*)=5 from private.workflow_emails),'mail: receipt owner/client, initial expert and two issued versions only');
select public.qa_assert((select count(*)=2 from private.workflow_emails where kind='report_published' and recipient_role='client'),'mail: actual publication transitions enqueue once each');
select public.qa_assert(not exists(select 1 from private.workflow_emails where recipient_id in (:'other',:'foreign_user')),'mail: unlinked/cross-org users excluded');
set local role anon;
select public.qa_denied('select public.claim_workflow_emails(5)','permission denied','mail: anonymous claim denied');
select public.qa_denied('select * from private.workflow_emails','permission denied','mail: anonymous queue read denied');
reset role;
set local role authenticated;
select public.qa_denied('select public.claim_workflow_emails(5)','permission denied','mail: even administrator JWT cannot claim');
select public.qa_denied('select * from private.workflow_emails','permission denied','mail: queue not exposed to signed-in users');
select public.qa_denied('update private.workflow_email_settings set enabled=true','permission denied','mail: client cannot enable dispatch');
reset role;
-- Reserved QA addresses are never returned to an actual sender.
select public.qa_assert(public.claim_workflow_emails(10)='[]'::jsonb,'mail: reserved addresses never dispatched');
select public.qa_assert((select count(*)=5 from private.workflow_emails where state='cancelled'),'mail: reserved jobs cancelled, not retried');
-- Repeat the same tests against a fake deliverable-shaped address, in local PG only.
update auth.users set email=replace(email,'example.invalid','local.fixture') where id in (:'owner',:'expert',:'client');
update private.workflow_emails set state='queued',reason=null;
select public.claim_workflow_emails(10) as jobs \gset
select public.qa_assert(jsonb_array_length(:'jobs')=4,'mail: withdrawn report filtered while current issue remains eligible');
select public.qa_assert(public.claim_workflow_emails(10)='[]'::jsonb,'mail: claimed work cannot be double-claimed');
select (:'jobs'::jsonb->0->>'id') as mail1,(:'jobs'::jsonb->0->>'claimToken') as token1,
 (:'jobs'::jsonb->1->>'id') as mail2,(:'jobs'::jsonb->1->>'claimToken') as token2,
 (:'jobs'::jsonb->2->>'id') as mail3,(:'jobs'::jsonb->2->>'claimToken') as token3,
 (:'jobs'::jsonb->3->>'id') as mail4,(:'jobs'::jsonb->3->>'claimToken') as token4 \gset
set local role service_role;
select public.qa_assert(not public.finish_workflow_email(:'mail1',gen_random_uuid(),'accepted','fake-id'),'mail: stale claim token rejected');
select public.qa_assert(public.finish_workflow_email(:'mail1',:'token1','accepted','fake-id'),'mail: provider acceptance recorded');
select public.qa_assert(not public.finish_workflow_email(:'mail1',:'token1','accepted','fake-id'),'mail: repeated completion no-op');
select public.finish_workflow_email(:'mail2',:'token2','unknown');
select public.finish_workflow_email(:'mail3',:'token3','failed');
select public.finish_workflow_email(:'mail4',:'token4','rate_limited',null,999999);
reset role;
select public.qa_assert((select state='accepted' from private.workflow_emails where id=:'mail1'),'mail: acceptance not called delivery');
select public.qa_assert((select state='unknown' from private.workflow_emails where id=:'mail2'),'mail: uncertain result never queued again');
select public.qa_assert((select state='failed' from private.workflow_emails where id=:'mail3'),'mail: permanent failure never queued again');
select public.qa_assert((select state='queued' and available_at<=now()+interval '1 hour' from private.workflow_emails where id=:'mail4'),'mail: 429 waits with bounded retry');
update private.workflow_emails set available_at=now(),attempts=3 where id=:'mail4';
-- Exhausted third attempt cannot be retried by a malicious/stale worker.
select public.claim_workflow_emails(1) as retry_job \gset
select public.finish_workflow_email(:'mail4',(:'retry_job'::jsonb->0->>'claimToken')::uuid,'rate_limited');
select public.qa_assert((select state='failed' from private.workflow_emails where id=:'mail4'),'mail: rate limit retries are finite');
-- New assignment events are valid; same-value writes are not new events.
select set_config('request.jwt.claim.sub',:'owner',true);
insert into public.inspections(organization_id,plant_id,inspection_code) values(:'org',:'plant','MAIL-NEW') returning id as mail_inspection \gset
update public.inspections set assigned_expert_user_id=:'expert' where id=:'mail_inspection';
select public.qa_assert((select count(*)=4 from private.workflow_emails where inspection_id=:'mail_inspection'),'mail: assignment notifies current expert and client');
update public.inspections set assigned_expert_user_id=:'expert' where id=:'mail_inspection';
select public.qa_assert((select count(*)=4 from private.workflow_emails where inspection_id=:'mail_inspection'),'mail: unchanged assignment does not duplicate');
update public.inspections set assigned_expert_user_id=null where id=:'mail_inspection';
select public.claim_workflow_emails(10);
select public.qa_assert((select count(*)=2 from private.workflow_emails where inspection_id=:'mail_inspection' and kind='expert_assigned' and state='cancelled'),'mail: superseded assignment withheld for both recipients');
update private.workflow_emails set claimed_at=now()-interval '6 minutes' where state='processing';
select public.claim_workflow_emails(10);
select public.qa_assert(not exists(select 1 from private.workflow_emails where state='processing'),'mail: crashed jobs become unknown, never reclaimed');
-- Permissions/membership and verified email are checked anew, not copied from client state.
insert into public.inspections(organization_id,plant_id,inspection_code) values(:'org',:'plant','MAIL-REVOKED') returning id as revoked_inspection \gset
update public.organization_members set status='suspended' where organization_id=:'org' and user_id=:'client';
update auth.users set email_confirmed_at=null where id=:'owner';
select public.claim_workflow_emails(10);
select public.qa_assert((select count(*)=2 from private.workflow_emails where inspection_id=:'revoked_inspection' and state='cancelled'),'mail: suspension and unverified email prevent sending');
-- Outbox writes roll back with their business transaction.
select count(*) as before_rollback from private.workflow_emails \gset
savepoint mail_rollback;
update auth.users set email_confirmed_at=now() where id=:'owner';
insert into public.inspections(organization_id,plant_id,inspection_code) values(:'org',:'plant','MAIL-ROLLBACK');
rollback to mail_rollback;
select public.qa_assert((select count(*)=:'before_rollback' from private.workflow_emails),'mail: rollback leaves no orphan notification');
select public.qa_assert(not exists(select 1 from public.audit_events where action like 'email.%' and metadata::text ~ '@|Bearer|re_'),'mail: audit omits recipients and secrets');
update auth.users set email_confirmed_at=now() where id=:'owner';
update public.organization_members set status='active' where organization_id=:'org' and user_id=:'client';
select set_config('request.jwt.claim.sub',:'client',true);
select gen_random_uuid() as replay_key \gset
set local role authenticated;
select id as replay_id from public.request_inspection(:'plant','알림 멱등성','',:'replay_key') \gset
select id as replay_id2 from public.request_inspection(:'plant','알림 멱등성','',:'replay_key') \gset
reset role;
select public.qa_assert(:'replay_id'=:'replay_id2','mail: same request returns same case');
select public.qa_assert((select count(*)=2 from private.workflow_emails where inspection_id=:'replay_id'),'mail: successful request replay does not duplicate recipients');
select public.qa_assert(not private.workflow_email_recipient(:'foreign_org',:'client','client',:'plant'),'mail: a foreign org cannot use a target plant');
insert into private.invited_password_setups(user_id,required) values(:'expert',true) on conflict(user_id) do update set required=true;
select public.qa_assert(not private.workflow_email_recipient(:'org',:'expert','expert',:'plant'),'mail: initial password requirement also blocks mail recipient readiness');
update private.invited_password_setups set required=false where user_id=:'expert';
-- The first attempt's confirmed email identity cannot silently change on retry.
select public.claim_workflow_emails(1) as fingerprint_job \gset
select (:'fingerprint_job'::jsonb->0->>'id') as fingerprint_id,(:'fingerprint_job'::jsonb->0->>'claimToken') as fingerprint_token \gset
select recipient_id as changed_recipient from private.workflow_emails where id=:'fingerprint_id' \gset
select public.finish_workflow_email(:'fingerprint_id',:'fingerprint_token','rate_limited');
update auth.users set email='changed-'||email where id=:'changed_recipient';
update private.workflow_emails set available_at=now() where id=:'fingerprint_id';
select public.claim_workflow_emails(10);
select public.qa_assert((select state='cancelled' from private.workflow_emails where id=:'fingerprint_id'),'mail: same idempotency key cannot send to a newly changed address');
