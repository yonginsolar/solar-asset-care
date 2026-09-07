-- Authenticated Storage URLs may remain cached per user after RLS changes.
-- Customers MUST use the uncached application gateway (which checks report RLS
-- on every request). The backend secret reads only the previously authorized asset.
drop policy report_images_read_authorized on storage.objects;
create policy report_images_read_authorized on storage.objects for select to authenticated
  using (bucket_id='report-images' and private.storage_inspection_access(name,false));
drop policy archived_pdf_select_viewers on storage.objects;
create policy archived_pdf_select_viewers on storage.objects for select to authenticated
  using (bucket_id='reports' and private.storage_inspection_access(name,false) and (
    exists(select 1 from public.report_documents d join public.report_snapshots s
      on s.report_id=d.report_id and s.sha256=d.snapshot_sha256 where d.storage_path=name and private.can_view_report(d.report_id))
    or exists(select 1 from public.reports r join public.report_snapshots s on s.report_id=r.id
      where r.status='approved' and private.has_org_role(r.organization_id,array['owner'])
      and name=r.organization_id::text||'/'||r.inspection_id::text||'/'||r.id::text||'/'||s.sha256||'.pdf')));
