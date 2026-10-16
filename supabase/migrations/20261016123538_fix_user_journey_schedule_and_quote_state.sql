-- A narrow schedule editor, using existing Auth/RLS/role gates, not a new role.
create function private.update_inspection_schedule(
 p_inspection_id uuid,p_expected_updated_at timestamptz,p_scheduled_at timestamptz,p_due_at timestamptz)
returns public.inspections language plpgsql security invoker set search_path='' as $$
declare i public.inspections%rowtype;
begin
 if (select auth.uid()) is null then raise exception '관리자만 점검 일정을 수정할 수 있습니다.'; end if;
 select * into i from public.inspections where id=p_inspection_id;
 if not found or not private.has_org_role(i.organization_id,array['owner'])
 then raise exception '관리자만 점검 일정을 수정할 수 있습니다.'; end if;
 select * into i from public.inspections where id=p_inspection_id for update;
 if not found then raise exception '현재 점검을 수정할 수 없습니다.'; end if;
 if i.status in ('closed','cancelled') then raise exception '종료·취소된 점검은 재개 후 일정을 수정해 주세요.'; end if;
 if i.updated_at is distinct from p_expected_updated_at
 then raise exception '점검이 변경되었습니다. 입력을 보관하고 다시 조회한 뒤 수정해 주세요.'; end if;
 if (p_scheduled_at is not null and not isfinite(p_scheduled_at))
   or (p_due_at is not null and not isfinite(p_due_at))
   or p_due_at<p_scheduled_at
 then raise exception '완료 목표는 예정 일시보다 빠를 수 없습니다. 날짜와 시간을 확인해 주세요.'; end if;
 update public.inspections set scheduled_at=p_scheduled_at,due_at=p_due_at,capture_timezone='Asia/Seoul'
 where id=i.id returning * into i;
 return i;
end $$;
create function public.update_inspection_schedule(
 p_inspection_id uuid,p_expected_updated_at timestamptz,p_scheduled_at timestamptz,p_due_at timestamptz)
returns public.inspections language sql security invoker set search_path='' as $$
 select private.update_inspection_schedule(p_inspection_id,p_expected_updated_at,p_scheduled_at,p_due_at);
$$;
revoke all on function private.update_inspection_schedule(uuid,timestamptz,timestamptz,timestamptz),
 public.update_inspection_schedule(uuid,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function private.update_inspection_schedule(uuid,timestamptz,timestamptz,timestamptz),
 public.update_inspection_schedule(uuid,timestamptz,timestamptz,timestamptz) to authenticated;

-- Keep the same schedule checks even for direct table updates. No audit INSERT
-- permission is granted to clients: this internal trigger writes only date deltas.
create function private.guard_inspection_schedule() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.scheduled_at is not distinct from old.scheduled_at and new.due_at is not distinct from old.due_at then return new; end if;
 if (new.scheduled_at is not null and not isfinite(new.scheduled_at))
   or (new.due_at is not null and not isfinite(new.due_at)) or new.due_at<new.scheduled_at
 then raise exception '완료 목표는 예정 일시보다 빠를 수 없습니다. 날짜와 시간을 확인해 주세요.'; end if;
 if (select auth.uid()) is null then return new; end if;
 if not private.has_org_role(old.organization_id,array['owner'])
 then raise exception '관리자만 점검 일정을 수정할 수 있습니다.'; end if;
 if old.status in ('closed','cancelled')
 then raise exception '종료·취소된 점검은 재개 후 일정을 수정해 주세요.'; end if;
 insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(old.organization_id,(select auth.uid()),'inspection.schedule_updated','inspection',old.id::text,
   jsonb_build_object('scheduled_at_before',old.scheduled_at,'scheduled_at_after',new.scheduled_at,
     'due_at_before',old.due_at,'due_at_after',new.due_at));
 return new;
end $$;
create trigger guard_inspection_schedule before update of scheduled_at,due_at on public.inspections
 for each row execute function private.guard_inspection_schedule();
revoke all on function private.guard_inspection_schedule() from public,anon,authenticated;
