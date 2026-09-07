-- Issuer-supplied evidence, not a platform-issued environmental certification.
create table public.recycling_certificates (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plant_id uuid not null references public.plants(id),
  title text not null check (length(title) between 1 and 160),
  issuer text not null check (length(issuer) between 1 and 120),
  certificate_number text not null default '' check (length(certificate_number)<=120),
  issued_on date not null,
  panel_count integer check (panel_count between 1 and 1000000),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  bytes integer not null check (bytes between 1 and 10000000),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','published','withdrawn')),
  revision integer not null default 1,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_reason text not null default '',
  unique (plant_id,sha256)
);
create index recycling_certificates_org_idx on public.recycling_certificates(organization_id,created_at desc);
create index recycling_certificates_creator_idx on public.recycling_certificates(created_by);
create index recycling_certificates_reviewer_idx on public.recycling_certificates(reviewed_by);
alter table public.recycling_certificates enable row level security;
revoke all on public.recycling_certificates from public,anon,authenticated;
grant select on public.recycling_certificates to authenticated;
create policy recycling_certificates_read on public.recycling_certificates for select to authenticated
  using ((select private.has_org_role(organization_id,array['owner']))
    or (status='published' and (select private.can_view_plant(plant_id))));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('recycling-certificates','recycling-certificates',false,10000000,
    array['application/pdf','image/jpeg','image/png']);
-- All readers, including staff, use the application gateway. No cached direct URLs.
create policy recycling_certificates_insert_owner on storage.objects for insert to authenticated
  with check(bucket_id='recycling-certificates' and private.storage_org_access(name,array['owner']));

create function private.register_recycling_certificate(p_id uuid,p_plant_id uuid,p_title text,p_issuer text,
  p_number text,p_issued_on date,p_panel_count integer,p_mime_type text,p_bytes integer,p_sha256 text)
returns public.recycling_certificates language plpgsql security definer set search_path='' as $$
declare plant public.plants%rowtype; result public.recycling_certificates%rowtype; path text; ext text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  select * into plant from public.plants where id=p_plant_id;
  if not found or not private.has_org_role(plant.organization_id,array['owner']) then
    raise exception '관리자만 인증서를 등록할 수 있습니다.';
  end if;
  if p_issued_on is null or p_issued_on<date '1900-01-01' or p_issued_on>(now() at time zone 'Asia/Seoul')::date then
    raise exception '발급일을 확인해 주세요.';
  end if;
  ext:=case p_mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' end;
  if ext is null then raise exception 'PDF·JPG·PNG 파일만 등록할 수 있습니다.'; end if;
  path:=plant.organization_id::text||'/'||plant.id::text||'/'||p_id::text||'.'||ext;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,419));
  select * into result from public.recycling_certificates where id=p_id;
  if found then
    if result.plant_id<>p_plant_id or result.sha256 is distinct from p_sha256 or result.bytes is distinct from p_bytes
      or result.title is distinct from trim(p_title) or result.issuer is distinct from trim(p_issuer)
      or result.certificate_number is distinct from trim(coalesce(p_number,'')) or result.issued_on is distinct from p_issued_on
      or result.panel_count is distinct from p_panel_count or result.mime_type is distinct from p_mime_type then
      raise exception '이미 등록된 인증서와 내용이 다릅니다.';
    end if;
    return result;
  end if;
  if not exists(select 1 from storage.objects where bucket_id='recycling-certificates' and name=path
    and owner_id=auth.uid()::text and (metadata->>'size')::integer=p_bytes and metadata->>'mimetype'=p_mime_type) then
    raise exception '저장된 인증서 파일을 확인하지 못했습니다.';
  end if;
  insert into public.recycling_certificates(id,organization_id,plant_id,title,issuer,certificate_number,issued_on,panel_count,
    storage_path,mime_type,bytes,sha256,created_by)
  values(p_id,plant.organization_id,plant.id,trim(p_title),trim(p_issuer),trim(coalesce(p_number,'')),p_issued_on,p_panel_count,
    path,p_mime_type,p_bytes,p_sha256,auth.uid()) returning * into result;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(plant.organization_id,auth.uid(),'recycling.registered','recycling_certificate',p_id::text,to_jsonb(result));
  return result;
end $$;
create function public.register_recycling_certificate(p_id uuid,p_plant_id uuid,p_title text,p_issuer text,
  p_number text,p_issued_on date,p_panel_count integer,p_mime_type text,p_bytes integer,p_sha256 text)
returns public.recycling_certificates language sql security invoker set search_path='' as $$
  select private.register_recycling_certificate(p_id,p_plant_id,p_title,p_issuer,p_number,p_issued_on,p_panel_count,p_mime_type,p_bytes,p_sha256);
$$;

create function private.review_recycling_certificate(p_id uuid,p_revision integer,p_sha256 text,p_publish boolean,p_reason text)
returns public.recycling_certificates language plpgsql security definer set search_path='' as $$
declare result public.recycling_certificates%rowtype; before_row jsonb;
begin
  if auth.uid() is null or p_publish is null then raise exception '로그인이 필요합니다.'; end if;
  select * into result from public.recycling_certificates where id=p_id for update;
  if not found or not private.has_org_role(result.organization_id,array['owner']) then
    raise exception '관리자만 인증서를 공개·회수할 수 있습니다.';
  end if;
  if result.revision is distinct from p_revision or result.sha256 is distinct from p_sha256 then
    raise exception '인증서가 변경됐습니다. 목록을 새로고침한 뒤 다시 확인해 주세요.';
  end if;
  if length(trim(coalesce(p_reason,''))) not between 2 and 500 then raise exception '확인 내용 또는 회수 사유를 입력해 주세요.'; end if;
  before_row:=to_jsonb(result);
  update public.recycling_certificates set status=case when p_publish then 'published' else 'withdrawn' end,
    revision=revision+1,reviewed_by=auth.uid(),reviewed_at=now(),review_reason=trim(p_reason)
    where id=p_id returning * into result;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(result.organization_id,auth.uid(),case when p_publish then 'recycling.published' else 'recycling.withdrawn' end,
      'recycling_certificate',p_id::text,jsonb_build_object('before',before_row,'after',to_jsonb(result)));
  return result;
end $$;
create function public.review_recycling_certificate(p_id uuid,p_revision integer,p_sha256 text,p_publish boolean,p_reason text)
returns public.recycling_certificates language sql security invoker set search_path='' as $$
  select private.review_recycling_certificate(p_id,p_revision,p_sha256,p_publish,p_reason);
$$;
revoke all on function private.register_recycling_certificate(uuid,uuid,text,text,text,date,integer,text,integer,text),
  public.register_recycling_certificate(uuid,uuid,text,text,text,date,integer,text,integer,text),
  private.review_recycling_certificate(uuid,integer,text,boolean,text),public.review_recycling_certificate(uuid,integer,text,boolean,text)
  from public,anon,authenticated;
grant execute on function private.register_recycling_certificate(uuid,uuid,text,text,text,date,integer,text,integer,text),
  public.register_recycling_certificate(uuid,uuid,text,text,text,date,integer,text,integer,text),
  private.review_recycling_certificate(uuid,integer,text,boolean,text),public.review_recycling_certificate(uuid,integer,text,boolean,text)
  to authenticated;
