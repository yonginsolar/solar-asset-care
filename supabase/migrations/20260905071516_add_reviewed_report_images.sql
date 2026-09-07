-- Independent project only. Derived JPEGs never replace the internal originals.
create table public.report_images (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id),
  source_file_id uuid not null references public.inspection_files(id),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  bytes integer not null check (bytes between 1 and 1200000),
  width integer not null check (width between 1 and 1280),
  height integer not null check (height between 1 and 1280),
  caption text not null check (length(caption) between 1 and 300),
  masks jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending','approved','excluded')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);
create index report_images_inspection_idx on public.report_images(inspection_id,status);
create index report_images_source_idx on public.report_images(source_file_id);
create index report_images_org_idx on public.report_images(organization_id);
create index report_images_creator_idx on public.report_images(created_by);
create index report_images_reviewer_idx on public.report_images(reviewed_by);
alter table public.report_images enable row level security;
revoke all on public.report_images from public,anon,authenticated;
grant select on public.report_images to authenticated;
create policy report_images_staff_read on public.report_images for select to authenticated
  using ((select private.can_work_inspection(inspection_id)));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('report-images','report-images',false,1200000,array['image/jpeg']);
create policy report_images_upload_staff on storage.objects for insert to authenticated
  with check (bucket_id='report-images' and private.storage_inspection_access(name,false));
-- No UPDATE or DELETE grant: approved images and older report revisions remain immutable.
create policy report_images_read_authorized on storage.objects for select to authenticated
  using (bucket_id='report-images' and (
    private.storage_inspection_access(name,false)
    or exists(select 1 from public.report_snapshots s
      where s.content->'reportImages' @> jsonb_build_array(jsonb_build_object('storage_path',name)))));

create function private.register_report_image(p_id uuid,p_source_file_id uuid,p_sha256 text,p_bytes integer,
  p_width integer,p_height integer,p_caption text,p_masks jsonb)
returns public.report_images language plpgsql security definer set search_path='' as $$
declare f public.inspection_files%rowtype; result public.report_images%rowtype; path text; mask jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  select * into f from public.inspection_files where id=p_source_file_id;
  if not found or not private.can_work_inspection(f.inspection_id) then raise exception '사진을 등록할 권한이 없습니다.'; end if;
  -- Serialize registration with image review/snapshot collection for this inspection.
  perform pg_advisory_xact_lock(hashtextextended(f.inspection_id::text,418));
  path:=f.organization_id::text||'/'||f.inspection_id::text||'/'||p_id::text||'.jpg';
  if not exists(select 1 from storage.objects where bucket_id='report-images' and name=path
    and owner_id=auth.uid()::text and (metadata->>'size')::integer=p_bytes and metadata->>'mimetype'='image/jpeg') then
    raise exception '저장된 보고서 사진을 확인하지 못했습니다.';
  end if;
  if p_masks is null or jsonb_typeof(p_masks)<>'array' or jsonb_array_length(p_masks)>20 then raise exception '가림 영역을 확인해 주세요.'; end if;
  for mask in select value from jsonb_array_elements(p_masks) loop
    if private.required_number(mask,'x',0,1)+private.required_number(mask,'width',0.000001,1)>1.000001
      or private.required_number(mask,'y',0,1)+private.required_number(mask,'height',0.000001,1)>1.000001 then
      raise exception '가림 영역이 사진을 벗어납니다.';
    end if;
  end loop;
  select * into result from public.report_images where id=p_id;
  if found then
    if result.created_by<>auth.uid() or result.source_file_id<>p_source_file_id or result.sha256<>p_sha256
      or result.caption<>trim(p_caption) or result.masks<>p_masks or result.bytes<>p_bytes
      or result.width<>p_width or result.height<>p_height then raise exception '이미 저장된 사진과 내용이 다릅니다.'; end if;
    return result;
  end if;
  insert into public.report_images(id,organization_id,inspection_id,source_file_id,storage_path,sha256,bytes,width,height,caption,masks,created_by)
    values(p_id,f.organization_id,f.inspection_id,f.id,path,p_sha256,p_bytes,p_width,p_height,trim(p_caption),p_masks,auth.uid()) returning * into result;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(f.organization_id,auth.uid(),'report.image_created','report_image',p_id::text,to_jsonb(result));
  return result;
end $$;
create function public.register_report_image(p_id uuid,p_source_file_id uuid,p_sha256 text,p_bytes integer,
  p_width integer,p_height integer,p_caption text,p_masks jsonb)
returns public.report_images language sql security invoker set search_path='' as $$
  select private.register_report_image(p_id,p_source_file_id,p_sha256,p_bytes,p_width,p_height,p_caption,p_masks);
$$;
create function private.review_report_image(p_id uuid,p_sha256 text,p_approve boolean)
returns public.report_images language plpgsql security definer set search_path='' as $$
declare result public.report_images%rowtype; before_row jsonb;
begin
  if auth.uid() is null or p_approve is null then raise exception '로그인이 필요합니다.'; end if;
  select * into result from public.report_images where id=p_id;
  if not found or not private.has_org_role(result.organization_id,array['owner']) then raise exception '관리자만 사진을 승인·제외할 수 있습니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(result.inspection_id::text,418));
  select * into result from public.report_images where id=p_id for update;
  if p_sha256 is distinct from result.sha256 then raise exception '화면의 사진이 변경됐습니다. 다시 확인해 주세요.'; end if;
  if p_approve and result.status<>'approved' and (select count(*) from public.report_images where inspection_id=result.inspection_id and status='approved')>=12 then
    raise exception '점검당 보고서 사진은 12장까지 승인할 수 있습니다.';
  end if;
  before_row:=to_jsonb(result);
  update public.report_images set status=case when p_approve then 'approved' else 'excluded' end,
    reviewed_by=auth.uid(),reviewed_at=now() where id=p_id returning * into result;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(result.organization_id,auth.uid(),'report.image_reviewed','report_image',p_id::text,
      jsonb_build_object('before',before_row,'after',to_jsonb(result)));
  return result;
end $$;
create function public.review_report_image(p_id uuid,p_sha256 text,p_approve boolean)
returns public.report_images language sql security invoker set search_path='' as $$
  select private.review_report_image(p_id,p_sha256,p_approve);
$$;

-- Old snapshots are untouched. New review requests freeze only approved derivatives.
create function private.freeze_report_images() returns trigger
language plpgsql security definer set search_path='' as $$
declare inspection uuid; images jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  select inspection_id into inspection from public.reports where id=new.report_id;
  if not private.can_work_inspection(inspection) then raise exception '검토 권한이 없습니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(inspection::text,418));
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'source_file_id',source_file_id,
    'storage_path',storage_path,'sha256',sha256,'caption',caption,'width',width,'height',height,
    'bytes',bytes,'masks',masks,'status',status,'reviewed_at',reviewed_at) order by created_at,id),'[]'::jsonb)
    into images from public.report_images where inspection_id=inspection and status='approved';
  new.content:=new.content||jsonb_build_object('reportImages',images);
  new.sha256:=encode(extensions.digest(new.content::text,'sha256'),'hex');
  return new;
end $$;
create trigger freeze_report_images before insert on public.report_snapshots
  for each row execute function private.freeze_report_images();
revoke all on function private.freeze_report_images() from public,anon,authenticated;
revoke all on function private.register_report_image(uuid,uuid,text,integer,integer,integer,text,jsonb),
  public.register_report_image(uuid,uuid,text,integer,integer,integer,text,jsonb),
  private.review_report_image(uuid,text,boolean),public.review_report_image(uuid,text,boolean) from public,anon,authenticated;
grant execute on function private.register_report_image(uuid,uuid,text,integer,integer,integer,text,jsonb),
  public.register_report_image(uuid,uuid,text,integer,integer,integer,text,jsonb),
  private.review_report_image(uuid,text,boolean),public.review_report_image(uuid,text,boolean) to authenticated;

-- Preserve archive validation and compatibility with already archived text PDFs.
do $$
declare body text;
begin
  body:=pg_get_functiondef('private.archive_report_pdf(uuid,text,text,bigint,text)'::regprocedure);
  if position('p_renderer_version<>''text-assessment-v1''' in body)=0 then raise exception 'Unexpected archive function version'; end if;
  execute replace(body,'p_renderer_version<>''text-assessment-v1''','p_renderer_version not in (''text-assessment-v1'',''reviewed-images-v2'')');
end $$;
