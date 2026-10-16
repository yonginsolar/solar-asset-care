export type WorkspaceCollection =
  | 'plants'
  | 'inspections'
  | 'inspection_files'
  | 'analysis_runs'
  | 'findings'
  | 'reports'
  | 'maintenance_requests'
  | 'partners'
  | 'partner_private_details'
  | 'quote_requests'
  | 'partner_quotes'
  | 'plant_requesters'
  | 'organization_members';
const plans: Record<string, readonly WorkspaceCollection[]> = {
  dashboard: ['plants', 'inspections', 'findings', 'maintenance_requests'],
  plants: ['plants', 'organization_members'],
  inspections: ['plants', 'inspections', 'organization_members'],
  files: ['plants', 'inspections', 'inspection_files', 'analysis_runs'],
  'report-images': ['inspections', 'inspection_files'],
  findings: ['inspections', 'inspection_files', 'findings'],
  assessments: ['plants', 'inspections'],
  'calculation-settings': [],
  reports: ['inspections', 'reports'],
  maintenance: ['inspections', 'maintenance_requests'],
  recycling: ['plants'],
  partners: [
    'plants',
    'inspections',
    'maintenance_requests',
    'partners',
    'partner_private_details',
    'quote_requests',
    'partner_quotes',
    'plant_requesters',
    'organization_members',
  ],
  members: ['organization_members'],
  account: [],
  'service-settings': [],
  customers: ['plants'],
};
/** Data planning only; current Auth checks and database RLS remain authoritative. */
export function workspaceCollections(
  view: string,
  role?: string,
): readonly WorkspaceCollection[] {
  if (view === 'dashboard' && role === 'client')
    return ['plants', 'inspections', 'reports', 'maintenance_requests'];
  if (view === 'dashboard' && role === 'expert')
    return ['plants', 'inspections', 'findings', 'reports'];
  return plans[view] ?? [];
}
