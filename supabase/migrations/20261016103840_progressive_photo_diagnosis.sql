-- Progressive intake: photo diagnosis first, optional full economic assessment later.
-- Existing v1 review snapshots and PDF archives are never rewritten.
do $$
declare body text;
begin
 body:=pg_get_functiondef('private.freeze_report_content()'::regprocedure);
 if position('촬영조건·발전량 평가를 저장한 뒤 검토를 요청해 주세요.' in body)=0
 then raise exception 'Unexpected report freeze function'; end if;
 body:=replace(body,
   'if not found then raise exception ''촬영조건·발전량 평가를 저장한 뒤 검토를 요청해 주세요.''; end if;',
   $photo$if not found then
      perform pg_advisory_xact_lock(hashtextextended(new.inspection_id::text,418));
      if not exists(select 1 from public.inspection_files where inspection_id=new.inspection_id and kind='thermal_original')
        or not exists(select 1 from public.report_images where inspection_id=new.inspection_id and status='approved')
      then raise exception '사진 진단 보고서는 열화상 원본과 관리자가 승인한 보고서 사진이 필요합니다.'; end if;
    end if;$photo$);
 body:=replace(body,'''schemaVersion'',1,','''schemaVersion'',case when a.inspection_id is null then 2 else 1 end,');
 body:=replace(body,'''assessment'',to_jsonb(a),''settings'',to_jsonb(s),',
   '''assessment'',case when a.inspection_id is null then ''null''::jsonb else to_jsonb(a) end,''settings'',case when a.inspection_id is null then ''null''::jsonb else to_jsonb(s) end,');
 body:=replace(body,'join public.calculation_settings s on s.id=a.settings_id','left join public.calculation_settings s on s.id=a.settings_id');
 body:=replace(body,'insert into public.report_snapshots(report_id,organization_id,content,sha256,frozen_by)',
   'if a.inspection_id is null then body:=body||jsonb_build_object(''diagnosisMode'',''photo-only''); end if;
    insert into public.report_snapshots(report_id,organization_id,content,sha256,frozen_by)');
 execute body;
end $$;

-- Representative name is not needed to start a diagnosis. Business identity and
-- admin-approved contact/plant links are unchanged; matching a number grants nothing.
do $$
declare body text;
begin
 body:=pg_get_functiondef('private.complete_service_profile(uuid,jsonb,uuid,boolean)'::regprocedure);
 if position('not between 1 and 80' in body)=0 then raise exception 'Unexpected profile validator'; end if;
 body:=replace(body,
   'or length(trim(coalesce(p_details->>''representative'',''''))) not between 1 and 80',
   'or length(trim(coalesce(p_details->>''representative'',''''))) > 80');
 body:=replace(body,'''representative'',trim(p_details->>''representative'')',
   '''representative'',nullif(trim(p_details->>''representative''),'''')');
 execute body;
end $$;
alter table private.customer_accounts drop constraint customer_accounts_check;
alter table private.customer_accounts add constraint customer_accounts_check check (
 (kind='individual' and business_number is null) or
 (kind<>'individual' and business_number is not null and business_number ~ '^[0-9]{10}$'
   and (representative is null or length(trim(representative)) between 1 and 80))
);

-- Narrow RPC; no UPDATE grant or RLS relaxation for customers. Organization lock
-- serializes with contact removal, and the exact edited revision prevents lost updates.
create function private.update_requester_plant(p_plant_id uuid,p_expected_updated_at timestamptz,
 p_name text,p_address text,p_capacity_kw numeric,p_commissioned_on date,
 p_operator_type text,p_module_model text,p_inverter_model text)
returns public.plants language plpgsql security definer set search_path='' as $$
declare p public.plants%rowtype; saved public.plants%rowtype;
begin
 select * into p from public.plants where id=p_plant_id;
 if not found or not private.service_member(p.organization_id,array['client'])
 then raise exception '이 발전소를 수정할 권한이 없습니다.'; end if;
 perform 1 from public.organizations where id=p.organization_id for update;
 select * into p from public.plants where id=p_plant_id for update;
 if not private.service_ready(p.organization_id) or not private.can_view_plant(p.id)
 then raise exception '이 발전소를 수정할 권한이 없습니다.'; end if;
 if p_expected_updated_at is distinct from p.updated_at
 then raise exception '발전소 정보가 변경되었습니다. 다시 불러온 후 수정해 주세요.'; end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 160
   or length(coalesce(p_address,''))>1000
   or (p_capacity_kw is not null and (p_capacity_kw<0 or p_capacity_kw>100000000 or p_capacity_kw::text in ('NaN','Infinity','-Infinity')))
   or p_commissioned_on>(now() at time zone 'Asia/Seoul')::date
   or coalesce(p_operator_type,'') not in ('','개인','법인','협동조합','공공','기타')
   or length(coalesce(p_module_model,''))>160 or length(coalesce(p_inverter_model,''))>160
 then raise exception '발전소 기본정보의 입력 범위를 확인해 주세요.'; end if;
 update public.plants set name=trim(p_name),address=nullif(trim(p_address),''),capacity_kw=p_capacity_kw,
   commissioned_on=p_commissioned_on,
   metadata=metadata||jsonb_build_object('operator_type',nullif(trim(p_operator_type),''),
     'module_model',nullif(trim(p_module_model),''),'inverter_model',nullif(trim(p_inverter_model),''))
 where id=p.id returning * into saved;
 insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id)
 values(p.organization_id,(select auth.uid()),'requester.plant_updated','plant',p.id::text);
 return saved;
end $$;
create function public.update_requester_plant(p_plant_id uuid,p_expected_updated_at timestamptz,
 p_name text,p_address text,p_capacity_kw numeric,p_commissioned_on date,
 p_operator_type text,p_module_model text,p_inverter_model text)
returns public.plants language sql security invoker set search_path='' as $$
 select private.update_requester_plant(p_plant_id,p_expected_updated_at,p_name,p_address,p_capacity_kw,
 p_commissioned_on,p_operator_type,p_module_model,p_inverter_model);
$$;
revoke all on function private.update_requester_plant(uuid,timestamptz,text,text,numeric,date,text,text,text),
 public.update_requester_plant(uuid,timestamptz,text,text,numeric,date,text,text,text) from public,anon,authenticated;
grant execute on function private.update_requester_plant(uuid,timestamptz,text,text,numeric,date,text,text,text),
 public.update_requester_plant(uuid,timestamptz,text,text,numeric,date,text,text,text) to authenticated;
