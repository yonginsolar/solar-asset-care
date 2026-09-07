-- Once registered, originals cannot be overwritten or removed by browser roles.
revoke delete on public.inspection_files from authenticated;
drop policy storage_originals_update_workers on storage.objects;
create policy storage_derived_update_workers on storage.objects for update to authenticated
  using (bucket_id='inspection-derived' and private.storage_inspection_access(name,false))
  with check (bucket_id='inspection-derived' and private.storage_inspection_access(name,false));
drop policy storage_originals_delete_admin on storage.objects;
create policy storage_unregistered_original_delete_admin on storage.objects for delete to authenticated
  using (bucket_id=any(array['inspection-originals','inspection-derived'])
    and private.storage_inspection_access(name,false) and private.storage_org_access(name,array['owner'])
    and not exists(select 1 from public.inspection_files f where f.storage_bucket=bucket_id and f.storage_path=name));

create function private.protect_original_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
    or new.inspection_id is distinct from old.inspection_id or new.storage_bucket is distinct from old.storage_bucket
    or new.storage_path is distinct from old.storage_path or new.sha256 is distinct from old.sha256
    or new.bytes is distinct from old.bytes or new.mime_type is distinct from old.mime_type
    or new.kind is distinct from old.kind or new.created_by is distinct from old.created_by then
    raise exception '등록된 원본의 연결·확인값은 변경할 수 없습니다. 새 파일로 등록해 주세요.';
  end if;
  return new;
end $$;
create trigger protect_original_identity before update on public.inspection_files
  for each row execute function private.protect_original_identity();
revoke all on function private.protect_original_identity() from public,anon,authenticated;
