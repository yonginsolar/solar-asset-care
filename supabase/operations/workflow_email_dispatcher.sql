-- Solar project only. Install AFTER the disabled outbox migration.
-- No provider/dispatch secrets in this file. The Vault token is provisioned
-- via hidden stdin by an authenticated operator; never put it in cron.command.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create or replace function private.dispatch_workflow_email() returns void
language plpgsql security definer set search_path='' as $dispatch$
declare token text; endpoint text; stamp text; nonce text; signature text;
begin
 if not (select enabled from private.workflow_email_settings where singleton) then return; end if;
 if not exists(select 1 from private.workflow_emails where (state='queued' and available_at<=now())
  or (state='processing' and claimed_at<now()-interval '5 minutes')) then return; end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='solar_workflow_email_dispatch_secret';
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='solar_workflow_email_endpoint';
 if token is null or length(token)<32 or endpoint is null or endpoint<>'https://vzgmryqglptxowbdewkf.supabase.co/functions/v1/workflow-email' then
  raise exception 'Workflow email dispatcher is not configured';
 end if;
 stamp:=floor(extract(epoch from clock_timestamp()))::bigint::text;
 nonce:=gen_random_uuid()::text;
 signature:=encode(extensions.hmac('POST:workflow-email:'||stamp||':'||nonce,token,'sha256'),'hex');
 perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json',
  'x-workflow-timestamp',stamp,'x-workflow-nonce',nonce,'x-workflow-signature',signature),
  body:='{}'::jsonb,timeout_milliseconds:=55000);
end $dispatch$;
revoke all on function private.dispatch_workflow_email() from public,anon,authenticated,service_role;
-- Idempotent installation; never change unrelated cron jobs.
select cron.schedule('solar-workflow-email-dispatch','* * * * *','select private.dispatch_workflow_email();');
-- Does NOT enable mail. Activation is a separate checked final step.
