-- One state predicate for starting, completing and resolving relative analysis.
-- Callers keep their existing Auth/work permission checks and parent-row lock.
-- An older immutable issue can coexist with a newer editable draft, not review.
create function private.relative_analysis_editable(p_inspection uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists (
  select 1 from public.inspections i
  where i.id=p_inspection and i.status not in ('published','closed','cancelled')
   and not exists(select 1 from public.reports r where r.inspection_id=i.id and r.status in ('review','approved'))
   and not exists(
    select 1 from public.reports issued where issued.inspection_id=i.id and issued.status='published'
     and not exists(select 1 from public.reports draft where draft.inspection_id=i.id
      and draft.status='draft' and draft.version>issued.version)
   )
 );
$$;
revoke all on function private.relative_analysis_editable(uuid) from public,anon,authenticated;

-- Replace only the inconsistent state predicates. Refuse an unexpected deployed
-- definition instead of dropping validation, leases, locking or audit behavior.
do $$
declare body text; old_condition text;
begin
 body:=pg_get_functiondef('private.start_relative_analysis(uuid,integer)'::regprocedure);
 old_condition:='if i.status in (''published'',''closed'',''cancelled'') or exists(select 1 from public.reports where inspection_id=i.id and status in (''review'',''approved''))';
 if position(old_condition in body)=0 then raise exception 'Unexpected relative analysis start guard'; end if;
 execute replace(body,old_condition,'if not private.relative_analysis_editable(i.id)');

 body:=pg_get_functiondef('private.complete_relative_analysis(uuid,jsonb,jsonb)'::regprocedure);
 old_condition:='if exists(select 1 from public.reports where inspection_id=run_row.inspection_id and status in (''review'',''approved'',''published''))';
 if position(old_condition in body)=0 then raise exception 'Unexpected relative analysis completion guard'; end if;
 execute replace(body,old_condition,'if not private.relative_analysis_editable(run_row.inspection_id)');

 body:=pg_get_functiondef('private.resolve_relative_analysis(uuid,text,text,text)'::regprocedure);
 old_condition:='if exists(select 1 from public.inspections where id=parent and status in (''published'',''closed'',''cancelled''))
 or exists(select 1 from public.reports where inspection_id=parent and status in (''review'',''approved'',''published''))';
 if position(old_condition in body)=0 then raise exception 'Unexpected relative analysis resolution guard'; end if;
 execute replace(body,old_condition,'if not private.relative_analysis_editable(parent)');
end $$;

-- Keep the existing schedule RPC, exact revision, Auth/RLS, owner-only writes
-- and date-delta audit. Synchronize only the initial request/scheduled pair.
do $$declare body text; anchor text; begin
 body:=pg_get_functiondef('private.update_inspection_schedule(uuid,timestamptz,timestamptz,timestamptz)'::regprocedure);
 anchor:='set scheduled_at=p_scheduled_at,due_at=p_due_at,capture_timezone=''Asia/Seoul''';
 if position(anchor in body)=0 then raise exception 'Unexpected inspection schedule update'; end if;
 execute replace(body,anchor,anchor||',status=case
  when i.status in (''requested'',''scheduled'') then case when p_scheduled_at is null then ''requested'' else ''scheduled'' end
  else i.status end');
end $$;

-- The invariant also applies to direct API writes. No legacy rows are rewritten.
create function private.guard_scheduled_inspection_date() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='scheduled' and (new.scheduled_at is null or not isfinite(new.scheduled_at))
 then raise exception '일정 확정에는 예정 일시가 필요합니다. 일정 수정에서 날짜와 시간을 입력해 주세요.'; end if;
 return new;
end $$;
revoke all on function private.guard_scheduled_inspection_date() from public,anon,authenticated;
create trigger guard_scheduled_inspection_date before insert or update on public.inspections
 for each row execute function private.guard_scheduled_inspection_date();
