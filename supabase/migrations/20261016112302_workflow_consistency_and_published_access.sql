-- Customers read frozen report snapshots, never mutable expert work in progress.
create or replace function private.can_view_finding(p_finding_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.findings f where f.id=p_finding_id
   and private.can_work_inspection(f.inspection_id));
$$;

alter table public.inspections add column workflow_reason text;

create function private.guard_inspection_workflow() returns trigger
language plpgsql security definer set search_path='' as $$
declare derived text; begin
 if tg_op='UPDATE' and new.status=old.status then return new; end if;
 select case
 when exists(select 1 from public.reports where inspection_id=new.id and status in ('review','approved')) then 'approval'
 when exists(select 1 from public.reports where inspection_id=new.id and status='draft') then 'expert_review'
 when exists(select 1 from public.reports where inspection_id=new.id and status='published') then 'published' end into derived;
 if derived is not null and new.status not in ('closed','cancelled') and new.status<>derived
 then raise exception '점검 상태는 보고서 진행 상태와 일치해야 합니다. 보고서 화면에서 처리해 주세요.'; end if;
 if new.status='published' and (not exists(select 1 from public.reports where inspection_id=new.id and status='published')
   or exists(select 1 from public.reports where inspection_id=new.id and status in ('draft','review','approved')))
 then raise exception '발행 상태는 발행된 보고서와 일치해야 합니다. 보고서 화면에서 처리해 주세요.'; end if;
 if new.status='approval' and not exists(select 1 from public.reports where inspection_id=new.id and status in ('review','approved'))
 then raise exception '보고서 화면에서 검토를 요청한 뒤 승인 단계로 이동할 수 있습니다.'; end if;
 if new.status='closed' and (not exists(select 1 from public.reports where inspection_id=new.id and status='published')
   or exists(select 1 from public.reports where inspection_id=new.id and status in ('draft','review','approved')))
 then raise exception '발행된 보고서가 있고 작성·검토 중인 보고서가 없어야 점검을 종료할 수 있습니다.'; end if;
 if new.status='cancelled' and exists(select 1 from public.reports where inspection_id=new.id and status='published')
 then raise exception '발행 보고서가 있는 점검은 취소 대신 종료하거나 보고서를 먼저 회수해 주세요.'; end if;
 if tg_op='UPDATE' and old.status in ('closed','cancelled') then
   if (select auth.uid()) is not null and not private.has_org_role(old.organization_id,array['owner'])
   then raise exception '관리자만 종료·취소된 점검을 재개할 수 있습니다.'; end if;
   if new.status not in ('published','expert_review') or nullif(trim(new.workflow_reason),'') is null
   then raise exception '점검 재개 사유를 입력해 주세요.'; end if;
 end if;
 if tg_op='UPDATE' and (select auth.uid()) is not null then
   insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
   values(new.organization_id,(select auth.uid()),'inspection.status_changed','inspection',new.id::text,
     jsonb_build_object('from',old.status,'to',new.status,'reason',new.workflow_reason));
 end if;
 return new;
end $$;
create trigger guard_inspection_workflow before insert or update on public.inspections
 for each row execute function private.guard_inspection_workflow();
revoke all on function private.guard_inspection_workflow() from public,anon,authenticated;

create function private.reopen_inspection(p_inspection_id uuid,p_expected_updated_at timestamptz,p_reason text)
returns public.inspections language plpgsql security definer set search_path='' as $$
declare i public.inspections%rowtype; begin
 select * into i from public.inspections where id=p_inspection_id for update;
 if not found or not private.has_org_role(i.organization_id,array['owner']) then raise exception '관리자만 점검을 재개할 수 있습니다.'; end if;
 if i.updated_at is distinct from p_expected_updated_at then raise exception '점검이 변경됐습니다. 다시 조회해 주세요.'; end if;
 if i.status not in ('closed','cancelled') then raise exception '종료·취소된 점검만 재개할 수 있습니다.'; end if;
 if nullif(trim(p_reason),'') is null or length(trim(p_reason))>1000 then raise exception '재개 사유를 1~1000자로 입력해 주세요.'; end if;
 update public.inspections set status=case when exists(select 1 from public.reports where inspection_id=i.id and status='published') then 'published' else 'expert_review' end,
 workflow_reason=trim(p_reason) where id=i.id returning * into i;
 return i;
end $$;
create function public.reopen_inspection(p_inspection_id uuid,p_expected_updated_at timestamptz,p_reason text)
returns public.inspections language sql security invoker set search_path='' as $$
 select private.reopen_inspection(p_inspection_id,p_expected_updated_at,p_reason);
$$;
revoke all on function private.reopen_inspection(uuid,timestamptz,text),public.reopen_inspection(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function private.reopen_inspection(uuid,timestamptz,text),public.reopen_inspection(uuid,timestamptz,text) to authenticated;

-- Closing locks editable evidence; existing originals, snapshots and PDFs stay intact.
create function private.guard_closed_inspection_content() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; state text; begin
 if (select auth.uid()) is null then return case when tg_op='DELETE' then old else new end; end if;
 target:=case when tg_op='DELETE' then old.inspection_id else new.inspection_id end;
 select status into state from public.inspections where id=target for update;
 if state in ('closed','cancelled') then raise exception '종료·취소된 점검입니다. 관리자가 점검을 재개한 뒤 보완해 주세요.'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$ declare t text; begin
 foreach t in array array['inspection_files','analysis_runs','findings','reports','report_images','inspection_assessments'] loop
 execute format('create trigger guard_closed_inspection_content before insert or update or delete on public.%I for each row execute function private.guard_closed_inspection_content()',t);
 end loop;
end $$;
revoke all on function private.guard_closed_inspection_content() from public,anon,authenticated;

create or replace function private.create_report_draft(p_inspection_id uuid,p_title text)
returns public.reports language plpgsql security definer set search_path='' as $$
declare i public.inspections%rowtype; r public.reports%rowtype; next_version integer; begin
 select * into i from public.inspections where id=p_inspection_id for update;
 if (select auth.uid()) is null or not found or not private.can_work_inspection(i.id) then raise exception '이 점검의 보고서 초안을 만들 권한이 없습니다.'; end if;
 if i.status in ('closed','cancelled') then raise exception '종료된 점검은 재개 후 보고서 초안을 만들어 주세요.'; end if;
 if exists(select 1 from public.reports where inspection_id=i.id and status in ('draft','review','approved')) then raise exception '작성·검토 중인 보고서가 있습니다. 기존 보고서를 먼저 처리해 주세요.'; end if;
 if nullif(trim(p_title),'') is null or length(trim(p_title))>240 then raise exception '보고서 제목은 1~240자로 입력해 주세요.'; end if;
 select coalesce(max(version),0)+1 into next_version from public.reports where inspection_id=i.id;
 insert into public.reports(organization_id,inspection_id,version,status,title,created_by)
 values(i.organization_id,i.id,next_version,'draft',trim(p_title),(select auth.uid())) returning * into r;
 update public.inspections set status='expert_review' where id=i.id;
 insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(i.organization_id,(select auth.uid()),'report.draft_created','report',r.id::text,jsonb_build_object('inspection_id',i.id,'version',next_version));
 return r;
end $$;

-- Lock parent first for all versions. Publishing a revision replaces the old
-- current issue atomically; a failed PDF/approval/constraint check rolls it all back.
create or replace function private.transition_report_status(p_report_id uuid,p_next_status text,p_reason text default null)
returns public.reports language plpgsql security definer set search_path='' as $$
declare r public.reports%rowtype; i public.inspections%rowtype; previous public.reports%rowtype;
 n text:=lower(trim(p_next_status)); reason text:=nullif(trim(p_reason),''); owner boolean; parent uuid; from_status text; begin
 if (select auth.uid()) is null then raise exception '로그인이 필요합니다.'; end if;
 select inspection_id into parent from public.reports where id=p_report_id;
 select * into i from public.inspections where id=parent for update;
 if not found or not private.can_work_inspection(i.id) then raise exception '이 보고서의 상태를 변경할 권한이 없습니다.'; end if;
 if i.status in ('closed','cancelled') then raise exception '종료·취소된 점검은 관리자가 재개한 뒤 처리해 주세요.'; end if;
 select * into r from public.reports where id=p_report_id for update;
 from_status:=r.status;
 owner:=private.has_org_role(r.organization_id,array['owner']);
 if r.status='draft' and n='review' then
   if not exists(select 1 from public.inspection_files where inspection_id=i.id) then raise exception '검토 요청 전에 점검 원본을 저장해 주세요.'; end if;
   if exists(select 1 from public.findings where inspection_id=i.id and disposition='pending') then raise exception '모든 분석 후보를 판정한 뒤 검토를 요청해 주세요.'; end if;
 elsif (r.status='review' and n in ('draft','approved')) or (r.status='approved' and n in ('draft','published')) or (r.status='published' and n='withdrawn') then
   if not owner then raise exception '관리자만 승인·발행·수정 요청·회수를 처리할 수 있습니다.'; end if;
   if n in ('draft','withdrawn') and reason is null then raise exception '변경 사유를 입력해 주세요.'; end if;
   if n='approved' and exists(select 1 from public.findings where inspection_id=i.id and disposition='pending') then raise exception '판정 대기 중인 분석 후보가 있어 승인할 수 없습니다.'; end if;
 else raise exception '허용되지 않은 보고서 상태 변경입니다: % → %',r.status,n;
 end if;
 if n='published' then
   select * into previous from public.reports where inspection_id=i.id and status='published' and id<>r.id for update;
   if found then
     if previous.version>=r.version then raise exception '현재 발행본보다 최신 버전만 개정 발행할 수 있습니다.'; end if;
     update public.reports set status='withdrawn',withdrawn_at=now(),change_reason=r.version||'차 개정본 발행으로 대체' where id=previous.id;
     insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
     values(r.organization_id,(select auth.uid()),'report.superseded','report',previous.id::text,jsonb_build_object('replacement_report_id',r.id));
   end if;
 end if;
 update public.reports set status=n,
 approved_by=case when n='approved' then (select auth.uid()) when n='draft' then null else approved_by end,
 approved_at=case when n='approved' then now() when n='draft' then null else approved_at end,
 published_at=case when n='published' then now() else published_at end,
 withdrawn_at=case when n='withdrawn' then now() else withdrawn_at end,
 change_reason=coalesce(reason,change_reason) where id=r.id returning * into r;
 update public.inspections set status=case
   when exists(select 1 from public.reports where inspection_id=i.id and status in ('review','approved')) then 'approval'
   when exists(select 1 from public.reports where inspection_id=i.id and status='draft') then 'expert_review'
   when exists(select 1 from public.reports where inspection_id=i.id and status='published') then 'published'
   else 'expert_review' end where id=i.id;
 insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(r.organization_id,(select auth.uid()),'report.status_changed','report',r.id::text,jsonb_build_object('inspection_id',i.id,'version',r.version,'from',from_status,'to',n,'reason',reason));
 return r;
end $$;

-- Only existing direct owners OR explicitly approved customer contacts qualify.
-- This helper is used only by quotation eligibility/access, not by worker roles.
create or replace function private.is_plant_requester(p_plant_id uuid,p_user_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.plants p join public.organization_members m
 on m.organization_id=p.organization_id and m.user_id=coalesce(p_user_id,(select auth.uid())) and m.role='client' and m.status='active'
 where p.id=p_plant_id and (exists(select 1 from public.plant_requesters pr where pr.plant_id=p.id and pr.requester_user_id=m.user_id)
 or exists(select 1 from private.customer_plants cp join private.customer_contacts cc on cc.customer_id=cp.customer_id and cc.organization_id=cp.organization_id
 join private.customer_accounts ca on ca.id=cp.customer_id and ca.organization_id=cp.organization_id
 where cp.plant_id=p.id and cp.organization_id=p.organization_id and cc.user_id=m.user_id and cc.active)));
$$;
create function private.get_quote_requesters(p_org uuid)
returns table(plant_id uuid,requester_user_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_org_role(p_org,array['owner']) then raise exception '관리자만 견적 담당자를 조회할 수 있습니다.'; end if;
 return query select p.id,m.user_id from public.plants p join public.organization_members m on m.organization_id=p.organization_id
 where p.organization_id=p_org and m.role='client' and m.status='active' and private.is_plant_requester(p.id,m.user_id);
end $$;
create function public.get_quote_requesters(p_org uuid) returns table(plant_id uuid,requester_user_id uuid)
language sql security invoker set search_path='' as $$select * from private.get_quote_requesters(p_org)$$;
revoke all on function private.get_quote_requesters(uuid),public.get_quote_requesters(uuid) from public,anon,authenticated;
grant execute on function private.get_quote_requesters(uuid),public.get_quote_requesters(uuid) to authenticated;

-- One canonical quotation selection feeds the linked maintenance task.
alter table public.maintenance_requests add column selected_quote_id uuid references public.partner_quotes(id);
create index maintenance_selected_quote_idx on public.maintenance_requests(selected_quote_id) where selected_quote_id is not null;
create function private.sync_quote_maintenance() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.maintenance_requests%rowtype; vendor text; begin
 if new.selected_quote_id is not distinct from old.selected_quote_id or new.maintenance_request_id is null then return new; end if;
 select * into m from public.maintenance_requests where id=new.maintenance_request_id for update;
 if m.status in ('in_progress','completed','cancelled') then raise exception '작업 중·완료·취소된 유지보수의 업체는 변경할 수 없습니다.'; end if;
 select p.name into vendor from public.partner_quotes q join public.partners p on p.id=q.partner_id
 where q.id=new.selected_quote_id and q.quote_request_id=new.id and q.organization_id=new.organization_id;
 if vendor is null then raise exception '선택한 업체 견적을 확인할 수 없습니다.'; end if;
 update public.maintenance_requests set selected_quote_id=new.selected_quote_id,vendor_name=vendor,
 status=case when status in ('requested','assigned','quoting') then 'assigned' else status end where id=m.id;
 return new;
end $$;
create trigger sync_quote_maintenance after update on public.quote_requests for each row execute function private.sync_quote_maintenance();
create function private.guard_maintenance_consistency() returns trigger
language plpgsql security definer set search_path='' as $$
declare selected uuid; vendor text; begin
 select qr.selected_quote_id,p.name into selected,vendor from public.quote_requests qr
 join public.partner_quotes q on q.id=qr.selected_quote_id join public.partners p on p.id=q.partner_id
 where qr.maintenance_request_id=new.id;
 if selected is not null then
   if new.selected_quote_id is distinct from selected or new.vendor_name is distinct from vendor
   then raise exception '연결된 견적의 선택 업체와 유지보수 업체가 일치해야 합니다.'; end if;
 elsif new.selected_quote_id is not null then raise exception '이 작업에 연결된 선택 견적이 아닙니다.'; end if;
 if new.status='completed' then new.completed_at:=coalesce(case when tg_op='UPDATE' and old.status='completed' then old.completed_at end,now());
 else new.completed_at:=null; end if;
 if tg_op='UPDATE' and old.status is distinct from new.status and (select auth.uid()) is not null then
   insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
   values(new.organization_id,(select auth.uid()),'maintenance.status_changed','maintenance',new.id::text,
     jsonb_build_object('from',old.status,'to',new.status,'previous_completed_at',old.completed_at,'completed_at',new.completed_at));
 end if;
 return new;
end $$;
create trigger guard_maintenance_consistency before insert or update on public.maintenance_requests for each row execute function private.guard_maintenance_consistency();
revoke all on function private.sync_quote_maintenance(),private.guard_maintenance_consistency() from public,anon,authenticated;
create or replace function private.record_partner_quote_response(
  p_quote_id uuid,
  p_amount_krw numeric,
  p_estimated_days integer,
  p_proposed_start_on date,
  p_valid_until date,
  p_scope text,
  p_conditions text,
  p_commission_rate numeric
)
returns public.partner_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  quote_row public.partner_quotes%rowtype;
  request_row public.quote_requests%rowtype;
  saved_quote public.partner_quotes%rowtype;
  parent_id uuid;
  total_quotes integer;
  submitted_quotes integer;
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select quote_request_id into parent_id from public.partner_quotes where id=p_quote_id;
  select * into request_row from public.quote_requests where id=parent_id for update;
  if not found or not private.has_org_role(request_row.organization_id,array['owner']) then
    raise exception '견적 회신을 기록할 권한이 없습니다.';
  end if;
  select * into quote_row from public.partner_quotes where id=p_quote_id for update;
  if request_row.status not in ('requested', 'collecting', 'ready_for_selection') then
    raise exception '현재 상태에서는 견적 회신을 변경할 수 없습니다.';
  end if;
  if p_amount_krw is null or p_amount_krw < 0 then
    raise exception '견적 금액을 입력해야 합니다.';
  end if;
  if p_estimated_days is not null and p_estimated_days <= 0 then
    raise exception '예상 기간은 1일 이상이어야 합니다.';
  end if;
  if p_commission_rate < 0 or p_commission_rate > 100 then
    raise exception '수수료율은 0부터 100 사이여야 합니다.';
  end if;
  if p_valid_until is not null and p_proposed_start_on is not null
    and p_valid_until < p_proposed_start_on
  then
    raise exception '견적 유효일은 작업 시작 예정일보다 빠를 수 없습니다.';
  end if;

  update public.partner_quotes
  set amount_krw = p_amount_krw,
      estimated_days = p_estimated_days,
      proposed_start_on = p_proposed_start_on,
      valid_until = p_valid_until,
      scope = nullif(trim(p_scope), ''),
      conditions = nullif(trim(p_conditions), ''),
      commission_rate = p_commission_rate,
      status = 'submitted',
      submitted_by = actor_id,
      submitted_at = now()
  where id = p_quote_id
  returning * into saved_quote;

  select count(*),
         count(*) filter (where status in ('submitted', 'selected', 'not_selected', 'completed'))
  into total_quotes, submitted_quotes
  from public.partner_quotes
  where quote_request_id = request_row.id;

  update public.quote_requests
  set status = case
        when submitted_quotes = total_quotes and total_quotes > 0
          then 'ready_for_selection'
        else 'collecting'
      end
  where id = request_row.id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    quote_row.organization_id,
    actor_id,
    'quote.response_recorded',
    'partner_quote',
    quote_row.id::text,
    jsonb_build_object(
      'quote_request_id', request_row.id,
      'partner_id', quote_row.partner_id,
      'amount_krw', p_amount_krw,
      'estimated_days', p_estimated_days
    )
  );

  return saved_quote;
end;
$$;


create or replace function private.validate_partner_quote_relations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plant_organization_id uuid;
  related_plant_id uuid;
  related_organization_id uuid;
  selected_request_id uuid;
begin
  if tg_table_name = 'quote_requests' then
    select organization_id into plant_organization_id
    from public.plants where id = new.plant_id;

    if plant_organization_id is null or new.organization_id <> plant_organization_id then
      raise exception '견적 요청의 조직과 발전소가 일치하지 않습니다.';
    end if;
    if tg_op='INSERT' or new.plant_id is distinct from old.plant_id or new.requester_user_id is distinct from old.requester_user_id then
    if not private.is_plant_requester(new.plant_id, new.requester_user_id)
      or not exists (
        select 1
        from public.organization_members membership
        where membership.organization_id = new.organization_id
          and membership.user_id = new.requester_user_id
          and membership.role = 'client'
          and membership.status = 'active'
      )
    then
      raise exception '견적 요청자는 해당 발전소의 활성 의뢰인이어야 합니다.';
    end if;

    end if;
    if new.inspection_id is not null then
      select plant_id, organization_id into related_plant_id, related_organization_id
      from public.inspections where id = new.inspection_id;
      if related_plant_id is null
        or related_plant_id <> new.plant_id
        or related_organization_id <> new.organization_id
      then
        raise exception '견적 요청의 점검과 발전소가 일치하지 않습니다.';
      end if;
    end if;

    if new.maintenance_request_id is not null then
      select inspection.plant_id, maintenance.organization_id
      into related_plant_id, related_organization_id
      from public.maintenance_requests maintenance
      join public.inspections inspection on inspection.id = maintenance.inspection_id
      where maintenance.id = new.maintenance_request_id;
      if related_plant_id is null
        or related_plant_id <> new.plant_id
        or related_organization_id <> new.organization_id
      then
        raise exception '견적 요청의 유지보수 작업과 발전소가 일치하지 않습니다.';
      end if;
    end if;

    if new.selected_quote_id is not null then
      select quote_request_id into selected_request_id
      from public.partner_quotes where id = new.selected_quote_id;
      if selected_request_id is null or selected_request_id <> new.id then
        raise exception '선택 견적이 해당 견적 요청에 속하지 않습니다.';
      end if;
    end if;
  elsif tg_table_name = 'partner_quotes' then
    select request.organization_id into related_organization_id
    from public.quote_requests request
    where request.id = new.quote_request_id;

    if related_organization_id is null or new.organization_id <> related_organization_id then
      raise exception '업체 견적의 조직과 견적 요청이 일치하지 않습니다.';
    end if;
    if not exists (
      select 1 from public.partners partner
      where partner.id = new.partner_id
        and partner.organization_id = new.organization_id
    ) then
      raise exception '업체 견적의 업체와 조직이 일치하지 않습니다.';
    end if;
  end if;

  return new;
end;
$$;


create or replace function private.create_quote_request_with_partners(
  p_plant_id uuid,
  p_requester_user_id uuid,
  p_title text,
  p_scope_summary text,
  p_response_due_at timestamptz,
  p_partner_ids uuid[],
  p_inspection_id uuid default null,
  p_maintenance_request_id uuid default null,
  p_commission_rate numeric default 0
)
returns public.quote_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  plant_row public.plants%rowtype;
  created_request public.quote_requests%rowtype;
  generated_code text;
  active_partner_count integer;
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into plant_row
  from public.plants
  where id = p_plant_id;

  if not found or not private.has_org_role(plant_row.organization_id, array['owner']) then
    raise exception '견적 요청을 만들 권한이 없습니다.';
  end if;
  if not private.is_plant_requester(p_plant_id,p_requester_user_id) then
    raise exception '이 발전소에 연결된 활성 의뢰인을 선택해야 합니다.';
  end if;
  if nullif(trim(p_title), '') is null then
    raise exception '견적 요청 제목을 입력해야 합니다.';
  end if;
  if cardinality(p_partner_ids) <> 3
    or (select count(distinct partner_id) from unnest(p_partner_ids) as partner_id) <> 3
  then
    raise exception '서로 다른 업체 3곳을 선택해야 합니다.';
  end if;
  if p_commission_rate < 0 or p_commission_rate > 100 then
    raise exception '수수료율은 0부터 100 사이여야 합니다.';
  end if;

  select count(*) into active_partner_count
  from public.partners partner
  where partner.id = any(p_partner_ids)
    and partner.organization_id = plant_row.organization_id
    and partner.status = 'active';

  if active_partner_count <> 3 then
    raise exception '같은 조직의 사용 중인 업체 3곳만 선택할 수 있습니다.';
  end if;

  generated_code := 'QT-'
    || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD')
    || '-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.quote_requests (
    organization_id,
    plant_id,
    inspection_id,
    maintenance_request_id,
    requester_user_id,
    request_code,
    title,
    scope_summary,
    status,
    response_due_at,
    requested_by,
    requested_at
  ) values (
    plant_row.organization_id,
    plant_row.id,
    p_inspection_id,
    p_maintenance_request_id,
    p_requester_user_id,
    generated_code,
    trim(p_title),
    nullif(trim(p_scope_summary), ''),
    'requested',
    p_response_due_at,
    actor_id,
    now()
  ) returning * into created_request;

  insert into public.partner_quotes (
    organization_id,
    quote_request_id,
    partner_id,
    status,
    commission_rate,
    requested_at,
    created_by
  )
  select
    plant_row.organization_id,
    created_request.id,
    partner_id,
    'requested',
    p_commission_rate,
    now(),
    actor_id
  from unnest(p_partner_ids) as partner_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    plant_row.organization_id,
    actor_id,
    'quote.requested',
    'quote_request',
    created_request.id::text,
    jsonb_build_object(
      'plant_id', plant_row.id,
      'requester_user_id', p_requester_user_id,
      'partner_ids', p_partner_ids,
      'response_due_at', p_response_due_at
    )
  );

  return created_request;
end;
$$;
