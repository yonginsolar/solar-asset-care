create or replace function public.project_keepalive()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true;
$$;

comment on function public.project_keepalive() is
  'Read-only health check used by the scheduled project activity monitor.';

revoke all on function public.project_keepalive() from public;
grant execute on function public.project_keepalive() to anon, authenticated;
