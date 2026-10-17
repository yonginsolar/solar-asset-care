-- Net's extension-owned queue may retain PUBLIC ACLs which postgres cannot
-- revoke. Store no reusable credential in it. Each signature is short-lived
-- and its nonce can be consumed only once by the authenticated server worker.
create table private.workflow_email_invocations (
 nonce uuid primary key,
 requested_at timestamptz not null
);
create index workflow_email_invocations_time_idx on private.workflow_email_invocations(requested_at);
alter table private.workflow_email_invocations enable row level security;
revoke all on private.workflow_email_invocations from public,anon,authenticated,service_role;
create policy no_direct_client_access on private.workflow_email_invocations
 for all to anon,authenticated using(false) with check(false);
create function public.accept_workflow_email_invocation(p_nonce uuid,p_timestamp bigint)
returns boolean language plpgsql security definer set search_path='' as $invocation$
declare inserted boolean;
begin
 if p_nonce is null or p_timestamp is null or abs(extract(epoch from clock_timestamp())-p_timestamp)>60 then return false; end if;
 delete from private.workflow_email_invocations where requested_at<now()-interval '10 minutes';
 insert into private.workflow_email_invocations(nonce,requested_at) values(p_nonce,to_timestamp(p_timestamp))
  on conflict(nonce) do nothing returning true into inserted;
 return coalesce(inserted,false);
end $invocation$;
revoke all on function public.accept_workflow_email_invocation(uuid,bigint) from public,anon,authenticated;
grant execute on function public.accept_workflow_email_invocation(uuid,bigint) to service_role;
