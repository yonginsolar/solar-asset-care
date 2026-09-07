-- Storage may evaluate nested application-table reads under its own role. Do not
-- rely only on the nested table's RLS; assert the viewer predicate explicitly.
drop policy report_images_read_authorized on storage.objects;
create policy report_images_read_authorized on storage.objects for select to authenticated
  using (bucket_id='report-images' and (
    private.storage_inspection_access(name,false)
    or exists(select 1 from public.report_snapshots s where private.can_view_report(s.report_id)
      and s.content->'reportImages' @> jsonb_build_array(jsonb_build_object('storage_path',name)))));
drop policy archived_pdf_select_viewers on storage.objects;
create policy archived_pdf_select_viewers on storage.objects for select to authenticated using (
  bucket_id='reports' and (exists(select 1 from public.report_documents d
    join public.report_snapshots s on s.report_id=d.report_id and s.sha256=d.snapshot_sha256
    where d.storage_path=name and private.can_view_report(d.report_id))
    or exists(select 1 from public.reports r join public.report_snapshots s on s.report_id=r.id
      where r.status='approved' and private.has_org_role(r.organization_id,array['owner'])
        and name=r.organization_id::text||'/'||r.inspection_id::text||'/'||r.id::text||'/'||s.sha256||'.pdf')));
