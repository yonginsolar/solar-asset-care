create function private.correct_recycling_certificate(p_id uuid,p_revision integer,p_plant_id uuid,p_title text,p_issuer text,
  p_number text,p_issued_on date,p_panel_count integer,p_reason text)
returns public.recycling_certificates language plpgsql security definer set search_path='' as $$
declare result public.recycling_certificates%rowtype; before_row jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  select * into result from public.recycling_certificates where id=p_id for update;
  if not found or not private.has_org_role(result.organization_id,array['owner']) then
    raise exception '관리자만 인증서 정보를 수정할 수 있습니다.';
  end if;
  if result.status='published' then raise exception '공개된 인증서는 먼저 회수한 뒤 수정해 주세요.'; end if;
  if result.revision is distinct from p_revision then raise exception '다른 관리자가 변경했습니다. 목록을 다시 불러와 주세요.'; end if;
  if not exists(select 1 from public.plants where id=p_plant_id and organization_id=result.organization_id) then
    raise exception '같은 조직의 발전소만 선택할 수 있습니다.';
  end if;
  if p_issued_on is null or p_issued_on<date '1900-01-01' or p_issued_on>(now() at time zone 'Asia/Seoul')::date then
    raise exception '발급일을 확인해 주세요.';
  end if;
  if length(trim(coalesce(p_reason,''))) not between 2 and 500 then raise exception '수정 사유를 입력해 주세요.'; end if;
  before_row:=to_jsonb(result);
  -- Keep the issuer's original bytes, storage path and checksum unchanged.
  update public.recycling_certificates set plant_id=p_plant_id,title=trim(p_title),issuer=trim(p_issuer),
    certificate_number=trim(coalesce(p_number,'')),issued_on=p_issued_on,panel_count=p_panel_count,
    status='pending',revision=revision+1,reviewed_by=null,reviewed_at=null,review_reason=''
    where id=p_id returning * into result;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(result.organization_id,auth.uid(),'recycling.corrected','recycling_certificate',p_id::text,
      jsonb_build_object('before',before_row,'after',to_jsonb(result),'reason',trim(p_reason)));
  return result;
end $$;
create function public.correct_recycling_certificate(p_id uuid,p_revision integer,p_plant_id uuid,p_title text,p_issuer text,
  p_number text,p_issued_on date,p_panel_count integer,p_reason text)
returns public.recycling_certificates language sql security invoker set search_path='' as $$
  select private.correct_recycling_certificate(p_id,p_revision,p_plant_id,p_title,p_issuer,p_number,p_issued_on,p_panel_count,p_reason);
$$;
revoke all on function private.correct_recycling_certificate(uuid,integer,uuid,text,text,text,date,integer,text),
  public.correct_recycling_certificate(uuid,integer,uuid,text,text,text,date,integer,text) from public,anon,authenticated;
grant execute on function private.correct_recycling_certificate(uuid,integer,uuid,text,text,text,date,integer,text),
  public.correct_recycling_certificate(uuid,integer,uuid,text,text,text,date,integer,text) to authenticated;
