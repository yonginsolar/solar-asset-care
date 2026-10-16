-- Preserve roles/RLS and immutable evidence; strengthen action identities only.
-- Filename matches the version recorded by the remote migration application.
alter table public.reports add column action_revision bigint not null default 1;
create function private.bump_action_revision() returns trigger
language plpgsql set search_path='' as $$begin
 new.action_revision:=old.action_revision+1; return new;
end $$;
revoke all on function private.bump_action_revision() from public,anon,authenticated;
create trigger zz_report_action_revision before update on public.reports
 for each row execute function private.bump_action_revision();

alter function private.transition_report_status(uuid,text,text) rename to transition_report_status_unchecked;
revoke all on function private.transition_report_status_unchecked(uuid,text,text) from public,anon,authenticated;
drop function public.transition_report_status(uuid,text,text);
create function private.transition_report_status(p_report_id uuid,p_next_status text,p_reason text,
 p_expected_revision bigint,p_expected_snapshot_sha256 text)
returns public.reports language plpgsql security definer set search_path='' as $$
declare r public.reports%rowtype; parent uuid; snapshot_hash text; begin
 if (select auth.uid()) is null then raise exception '로그인이 필요합니다.'; end if;
 select inspection_id into parent from public.reports where id=p_report_id;
 perform 1 from public.inspections where id=parent for update;
 if not found or not private.can_work_inspection(parent) then raise exception '이 보고서를 변경할 권한이 없습니다.'; end if;
 select * into r from public.reports where id=p_report_id for update;
 if lower(trim(p_next_status)) in ('approved','published','withdrawn','draft')
   and not private.has_org_role(r.organization_id,array['owner'])
 then raise exception '관리자만 승인·발행·수정 요청·회수를 처리할 수 있습니다.'; end if;
 select sha256 into snapshot_hash from public.report_snapshots where report_id=r.id;
 if p_expected_revision is distinct from r.action_revision or p_expected_snapshot_sha256 is distinct from snapshot_hash
 then raise exception '보고서 또는 검토본이 변경되었습니다. 다시 불러와 내용을 확인한 뒤 처리해 주세요.'; end if;
 return private.transition_report_status_unchecked(p_report_id,p_next_status,p_reason);
end $$;
create function public.transition_report_status(p_report_id uuid,p_next_status text,p_reason text default null,
 p_expected_revision bigint default null,p_expected_snapshot_sha256 text default null)
returns public.reports language sql security invoker set search_path='' as $$
 select private.transition_report_status(p_report_id,p_next_status,p_reason,p_expected_revision,p_expected_snapshot_sha256);
$$;
revoke all on function private.transition_report_status(uuid,text,text,bigint,text),public.transition_report_status(uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function private.transition_report_status(uuid,text,text,bigint,text),public.transition_report_status(uuid,text,text,bigint,text) to authenticated;

-- Analysis leases are resolved only by explicit writes. Reads never auto-retry jobs.
alter table public.analysis_runs add column reviewed_by uuid references auth.users(id),
 add column reviewed_at timestamptz,add column review_note text;
create index analysis_runs_reviewer_idx on public.analysis_runs(reviewed_by);
create unique index analysis_runs_one_running_per_file_idx
 on public.analysis_runs((input_manifest->>'inspection_file_id'))
 where status='running' and algorithm_key='rgb-luminance-relative' and input_manifest ? 'inspection_file_id';
create function private.check_analysis_before_review(p_inspection uuid) returns void
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.analysis_runs where inspection_id=p_inspection and status in ('queued','running'))
 then raise exception '분석이 아직 끝나지 않았습니다. 완료하거나 실행 중단을 확인한 뒤 검토해 주세요.'; end if;
 if exists(select 1 from (
   select distinct on(input_manifest->>'inspection_file_id') status,reviewed_at
   from public.analysis_runs where inspection_id=p_inspection and algorithm_key='rgb-luminance-relative'
   order by input_manifest->>'inspection_file_id',started_at desc nulls last,requested_at desc,id desc
 ) latest where status in ('failed','cancelled') and reviewed_at is null)
 then raise exception '실패·중단된 분석이 있습니다. 재분석하거나 사진 직접 검토를 확인해 주세요.'; end if;
end $$;
revoke all on function private.check_analysis_before_review(uuid) from public,anon,authenticated;
create function private.guard_analysis_report_progress() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.status in ('review','approved','published') and new.status is distinct from old.status
 then perform private.check_analysis_before_review(new.inspection_id); end if;
 return new;
end $$;
create trigger aa_analysis_before_report_progress before update on public.reports
 for each row execute function private.guard_analysis_report_progress();
revoke all on function private.guard_analysis_report_progress() from public,anon,authenticated;

create or replace function private.start_relative_analysis(p_inspection_file_id uuid,p_normalized_pixels integer)
returns public.analysis_runs language plpgsql security definer set search_path='' as $$
declare f public.inspection_files%rowtype; i public.inspections%rowtype; r public.analysis_runs%rowtype; begin
 if (select auth.uid()) is null then raise exception '로그인이 필요합니다.'; end if;
 if p_normalized_pixels is null or p_normalized_pixels not between 1 and 96000 then raise exception '분석 픽셀 수가 허용 범위를 벗어났습니다.'; end if;
 select * into f from public.inspection_files where id=p_inspection_file_id;
 if not found or not private.can_work_inspection(f.inspection_id) then raise exception '이 원본을 분석할 권한이 없습니다.'; end if;
 select * into i from public.inspections where id=f.inspection_id for update;
 if f.kind<>'thermal_original' or f.mime_type not in ('image/jpeg','image/png') then raise exception '상대 분석은 열화상 JPG 또는 PNG 원본만 지원합니다.'; end if;
 if i.status in ('published','closed','cancelled') or exists(select 1 from public.reports where inspection_id=i.id and status in ('review','approved'))
 then raise exception '발행·종료·취소 또는 보고서 검토 중에는 다시 분석할 수 없습니다. 수정 요청 후 진행해 주세요.'; end if;
 if exists(select 1 from public.analysis_runs where algorithm_key='rgb-luminance-relative' and status='succeeded' and input_manifest->>'inspection_file_id'=f.id::text)
 then raise exception '이 원본의 상대 분석이 이미 완료됐습니다.'; end if;
 update public.analysis_runs set status='failed',error_code='RELATIVE_ANALYSIS_EXPIRED',finished_at=clock_timestamp(),
 result_summary=jsonb_build_object('message','분석 응답이 확인되지 않아 재실행 시 이전 실행을 만료했습니다.')
 where inspection_id=i.id and algorithm_key='rgb-luminance-relative' and status='running'
   and input_manifest->>'inspection_file_id'=f.id::text and started_at<clock_timestamp()-interval '10 minutes';
 if exists(select 1 from public.analysis_runs where algorithm_key='rgb-luminance-relative' and status='running' and input_manifest->>'inspection_file_id'=f.id::text)
 then raise exception '같은 원본을 이미 분석 중입니다. 실행 상태를 확인해 주세요.'; end if;
 insert into public.analysis_runs(organization_id,inspection_id,algorithm_key,algorithm_version,status,input_manifest,requested_by,started_at)
 values(f.organization_id,i.id,'rgb-luminance-relative','1.0.0','running',jsonb_build_object('inspection_file_id',f.id,'normalized_pixels',p_normalized_pixels),(select auth.uid()),clock_timestamp()) returning * into r;
 return r;
end $$;

-- Keep the established atomic candidate validation, adding parent-first locking,
-- strict NULL rejection, a lease and report-state checks before any child write.
do $$declare body text; old_lock text; new_lock text; begin
 body:=pg_get_functiondef('private.complete_relative_analysis(uuid,jsonb,jsonb)'::regprocedure);
 old_lock:='  select * into run_row
  from public.analysis_runs
  where id = p_analysis_run_id
  for update;';
 new_lock:='  select * into run_row from public.analysis_runs where id=p_analysis_run_id;
  perform 1 from public.inspections where id=run_row.inspection_id for update;
  select * into run_row from public.analysis_runs where id=p_analysis_run_id for update;';
 if position(old_lock in body)=0 then raise exception 'Unexpected analysis completion function'; end if;
 body:=replace(body,old_lock,new_lock);
 body:=replace(body,'finished_at_value timestamptz := now();','finished_at_value timestamptz := clock_timestamp();');
 body:=replace(body,'jsonb_typeof(p_result_summary) <> ''object''','jsonb_typeof(p_result_summary) is distinct from ''object''');
 body:=replace(body,'jsonb_typeof(p_regions) <> ''array''','jsonb_typeof(p_regions) is distinct from ''array''');
 body:=replace(body,'  region_count := jsonb_array_length(p_regions);',
 '  if run_row.started_at<clock_timestamp()-interval ''10 minutes'' then raise exception ''분석 실행이 만료됐습니다. 다시 분석해 주세요.''; end if;
  if exists(select 1 from public.reports where inspection_id=run_row.inspection_id and status in (''review'',''approved'',''published'')) then raise exception ''보고서 검토 중에는 분석을 완료할 수 없습니다.''; end if;
  region_count := jsonb_array_length(p_regions);');
 execute body;
 body:=pg_get_functiondef('private.fail_relative_analysis(uuid,text)'::regprocedure);
 if position(old_lock in body)=0 then raise exception 'Unexpected analysis failure function'; end if;
 body:=replace(body,old_lock,new_lock);
 body:=replace(body,'finished_at_value timestamptz := now();','finished_at_value timestamptz := clock_timestamp();');
 execute body;
end $$;
create function private.resolve_relative_analysis(p_analysis_run_id uuid,p_expected_status text,p_action text,p_reason text)
returns public.analysis_runs language plpgsql security definer set search_path='' as $$
declare r public.analysis_runs%rowtype; parent uuid; begin
 if (select auth.uid()) is null then raise exception '로그인이 필요합니다.'; end if;
 select inspection_id into parent from public.analysis_runs where id=p_analysis_run_id;
 perform 1 from public.inspections where id=parent for update;
 if not found or not private.can_work_inspection(parent) then raise exception '이 분석을 확인할 권한이 없습니다.'; end if;
 select * into r from public.analysis_runs where id=p_analysis_run_id for update;
 if r.status is distinct from p_expected_status or r.algorithm_key<>'rgb-luminance-relative'
 then raise exception '분석 상태가 변경됐습니다. 다시 불러와 확인해 주세요.'; end if;
 if nullif(trim(p_reason),'') is null or length(trim(p_reason))>300 then raise exception '확인 사유를 1~300자로 입력해 주세요.'; end if;
 if exists(select 1 from public.inspections where id=parent and status in ('published','closed','cancelled'))
 or exists(select 1 from public.reports where inspection_id=parent and status in ('review','approved','published')) then raise exception '발행·종료·취소 또는 보고서 검토 중에는 분석 확인을 변경할 수 없습니다.'; end if;
 if p_action='cancel' and r.status='running' then
   if r.requested_by is distinct from (select auth.uid()) and not private.has_org_role(r.organization_id,array['owner']) and r.started_at>clock_timestamp()-interval '10 minutes'
   then raise exception '다른 담당자가 분석 중입니다. 완료 또는 만료 후 확인해 주세요.'; end if;
   update public.analysis_runs set status='cancelled',finished_at=clock_timestamp(),error_code='RELATIVE_ANALYSIS_CANCELLED',result_summary=jsonb_build_object('message',trim(p_reason)) where id=r.id returning * into r;
 elsif p_action='manual_review' and r.status in ('failed','cancelled') then
   if r.reviewed_at is not null then return r; end if;
   update public.analysis_runs set reviewed_by=(select auth.uid()),reviewed_at=clock_timestamp(),review_note=trim(p_reason) where id=r.id returning * into r;
 else raise exception '현재 분석 상태에서 사용할 수 없는 확인 작업입니다.'; end if;
 insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(r.organization_id,(select auth.uid()),'analysis.relative_resolved','analysis_run',r.id::text,jsonb_build_object('action',p_action,'reason',trim(p_reason),'inspection_id',parent));
 return r;
end $$;
create function public.resolve_relative_analysis(p_analysis_run_id uuid,p_expected_status text,p_action text,p_reason text)
returns public.analysis_runs language sql security invoker set search_path='' as $$
 select private.resolve_relative_analysis(p_analysis_run_id,p_expected_status,p_action,p_reason);
$$;
revoke all on function private.resolve_relative_analysis(uuid,text,text,text),public.resolve_relative_analysis(uuid,text,text,text) from public,anon,authenticated;
grant execute on function private.resolve_relative_analysis(uuid,text,text,text),public.resolve_relative_analysis(uuid,text,text,text) to authenticated;

-- Evidence operations use the same parent -> advisory -> child order as review.
do $$declare body text; anchor text; begin
 body:=pg_get_functiondef('private.register_report_image(uuid,uuid,text,integer,integer,integer,text,jsonb)'::regprocedure);
 anchor:='  perform pg_advisory_xact_lock(hashtextextended(f.inspection_id::text,418));';
 if position(anchor in body)=0 then raise exception 'Unexpected image registration function'; end if;
 execute replace(body,anchor,'  perform 1 from public.inspections where id=f.inspection_id for update;
  if not private.can_work_inspection(f.inspection_id) then raise exception ''사진 등록 권한이 변경됐습니다.''; end if;
'||anchor);
 body:=pg_get_functiondef('private.review_report_image(uuid,text,boolean)'::regprocedure);
 anchor:='  perform pg_advisory_xact_lock(hashtextextended(result.inspection_id::text,418));';
 if position(anchor in body)=0 then raise exception 'Unexpected image review function'; end if;
 execute replace(body,anchor,'  perform 1 from public.inspections where id=result.inspection_id for update;
  if not private.has_org_role(result.organization_id,array[''owner'']) then raise exception ''관리자 권한이 변경됐습니다.''; end if;
'||anchor);
 body:=pg_get_functiondef('private.archive_report_pdf(uuid,text,text,bigint,text)'::regprocedure);
 anchor:='  select * into r from public.reports where id=p_report_id for update;';
 if position(anchor in body)=0 then raise exception 'Unexpected PDF archive function'; end if;
 execute replace(body,anchor,'  perform 1 from public.inspections where id=(select inspection_id from public.reports where id=p_report_id) for update;
'||anchor);
end $$;

alter table public.partner_quotes add column action_revision bigint not null default 1;
alter table public.quote_requests add column action_revision bigint not null default 1;
create trigger zz_quote_action_revision before update on public.partner_quotes
 for each row execute function private.bump_action_revision();
create trigger zz_quote_request_action_revision before update on public.quote_requests
 for each row execute function private.bump_action_revision();
alter function private.select_partner_quote(uuid) rename to select_partner_quote_unchecked;
revoke all on function private.select_partner_quote_unchecked(uuid) from public,anon,authenticated;
drop function public.select_partner_quote(uuid);
create function private.select_partner_quote(p_quote_id uuid,p_expected_quote_revision bigint,p_expected_request_revision bigint)
returns public.partner_quotes language plpgsql security definer set search_path='' as $$
declare q public.partner_quotes%rowtype; r public.quote_requests%rowtype; parent uuid; begin
 if (select auth.uid()) is null then raise exception '로그인이 필요합니다.'; end if;
 select quote_request_id into parent from public.partner_quotes where id=p_quote_id;
 select * into r from public.quote_requests where id=parent for update;
 if not found or not (private.has_org_role(r.organization_id,array['owner']) or
 (r.requester_user_id=(select auth.uid()) and private.is_plant_requester(r.plant_id,(select auth.uid()))))
 then raise exception '이 견적을 선택할 권한이 없습니다.'; end if;
 select * into q from public.partner_quotes where id=p_quote_id for update;
 if q.action_revision is distinct from p_expected_quote_revision or r.action_revision is distinct from p_expected_request_revision
 then raise exception '견적 금액·조건 또는 선택 상태가 변경됐습니다. 다시 불러와 비교한 뒤 선택해 주세요.'; end if;
 if q.valid_until<(clock_timestamp() at time zone 'Asia/Seoul')::date
 then raise exception '유효기간이 지난 견적입니다. 관리자에게 최신 견적 확인을 요청해 주세요.'; end if;
 return private.select_partner_quote_unchecked(p_quote_id);
end $$;
create function public.select_partner_quote(p_quote_id uuid,p_expected_quote_revision bigint default null,p_expected_request_revision bigint default null)
returns public.partner_quotes language sql security invoker set search_path='' as $$
 select private.select_partner_quote(p_quote_id,p_expected_quote_revision,p_expected_request_revision);
$$;
revoke all on function private.select_partner_quote(uuid,bigint,bigint),public.select_partner_quote(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function private.select_partner_quote(uuid,bigint,bigint),public.select_partner_quote(uuid,bigint,bigint) to authenticated;

-- One transaction for the administrator's plant plus optional client link.
-- Existing RLS/table roles stay unchanged; no additional data access is granted.
create function public.save_admin_plant(p_organization_id uuid,p_plant_id uuid,p_expected_updated_at timestamptz,
 p_details jsonb,p_requester_user_id uuid default null)
returns public.plants language plpgsql security invoker set search_path='' as $$
declare p public.plants%rowtype; saved public.plants%rowtype; cap numeric; commissioned date; meta jsonb; fingerprint text; begin
 if (select auth.uid()) is null or not private.has_org_role(p_organization_id,array['owner']) then raise exception '관리자만 발전소를 저장할 수 있습니다.'; end if;
 if p_plant_id is null or jsonb_typeof(p_details) is distinct from 'object' then raise exception '발전소 입력 정보를 확인해 주세요.'; end if;
 if length(trim(coalesce(p_details->>'name',''))) not between 1 and 160 or length(coalesce(p_details->>'address',''))>1000
 or length(coalesce(p_details->>'code',''))>160 or length(coalesce(p_details->>'module_model',''))>160 or length(coalesce(p_details->>'inverter_model',''))>160
 or coalesce(p_details->>'operator_type','') not in ('','개인','법인','협동조합','공공','기타')
 then raise exception '발전소 기본정보의 입력 범위를 확인해 주세요.'; end if;
 if p_details->>'capacity_kw' is not null then
  if jsonb_typeof(p_details->'capacity_kw')<>'number' then raise exception '설비용량은 숫자로 입력해 주세요.'; end if;
  cap:=(p_details->>'capacity_kw')::numeric;
  if cap<0 or cap>100000000 then raise exception '설비용량의 입력 범위를 확인해 주세요.'; end if;
 end if;
 commissioned:=nullif(p_details->>'commissioned_on','')::date;
 if commissioned is not null and (not isfinite(commissioned) or commissioned>(clock_timestamp() at time zone 'Asia/Seoul')::date) then raise exception '상업운전 시작일을 확인해 주세요.'; end if;
 -- Plant row serializes edits; creation request ID is stable across an unknown response.
 perform pg_advisory_xact_lock(hashtextextended(p_plant_id::text,419));
 select * into p from public.plants where id=p_plant_id and organization_id=p_organization_id for update;
 fingerprint:=encode(extensions.digest(jsonb_build_object('details',p_details,'requester',p_requester_user_id)::text,'sha256'),'hex');
 if p_expected_updated_at is null and found then
   if p.metadata->>'registration_actor'=(select auth.uid())::text and p.metadata->>'registration_hash'=fingerprint then return p; end if;
   raise exception '이미 등록된 발전소 또는 다른 등록 요청입니다. 목록을 확인해 주세요.';
 elsif p_expected_updated_at is not null then
   if not found or p.updated_at is distinct from p_expected_updated_at then raise exception '발전소 정보가 변경됐습니다. 입력을 보관하고 다시 확인해 주세요.'; end if;
 elsif coalesce((p_details->>'data_use_consent')::boolean,false) is not true then raise exception '발전소 자료 처리 동의를 확인해 주세요.';
 end if;
 meta:=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('operator_type',nullif(trim(p_details->>'operator_type'),''),
 'module_model',nullif(trim(p_details->>'module_model'),''),'inverter_model',nullif(trim(p_details->>'inverter_model'),''));
 if p_expected_updated_at is null then
  meta:=meta||jsonb_build_object('data_use_consent_at',clock_timestamp(),'data_use_consent_version','operational-registration-v1','registration_actor',(select auth.uid()),'registration_hash',fingerprint);
  insert into public.plants(id,organization_id,name,code,address,capacity_kw,commissioned_on,timezone,metadata)
  values(p_plant_id,p_organization_id,trim(p_details->>'name'),nullif(trim(p_details->>'code'),''),nullif(trim(p_details->>'address'),''),cap,commissioned,'Asia/Seoul',meta) returning * into saved;
  if p_requester_user_id is not null then perform public.assign_requester_to_plant(saved.id,p_requester_user_id); end if;
 else
  update public.plants set name=trim(p_details->>'name'),code=nullif(trim(p_details->>'code'),''),address=nullif(trim(p_details->>'address'),''),capacity_kw=cap,commissioned_on=commissioned,timezone='Asia/Seoul',metadata=meta
  where id=p.id and organization_id=p_organization_id and updated_at=p_expected_updated_at returning * into saved;
  if not found then raise exception '발전소를 수정하지 못했습니다. 현재 권한과 수정판을 확인해 주세요.'; end if;
 end if;
 return saved;
end $$;
revoke all on function public.save_admin_plant(uuid,uuid,timestamptz,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_admin_plant(uuid,uuid,timestamptz,jsonb,uuid) to authenticated;
