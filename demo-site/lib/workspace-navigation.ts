export const workspaceViews = [
  'dashboard',
  'plants',
  'inspections',
  'files',
  'report-images',
  'recycling',
  'findings',
  'assessments',
  'calculation-settings',
  'reports',
  'maintenance',
  'partners',
  'members',
  'service-settings',
  'customers',
  'audit',
  'account',
] as const;
export type WorkspaceView = (typeof workspaceViews)[number];
export type WorkspaceLocation = { view: WorkspaceView; inspectionId: string };
/** Presentation allowlist only. Actual account readiness, RLS and write gates remain authoritative. */
export const roleViews: Record<string, readonly WorkspaceView[]> = {
  owner: workspaceViews,
  expert: [
    'dashboard',
    'plants',
    'inspections',
    'files',
    'report-images',
    'findings',
    'assessments',
    'reports',
    'maintenance',
    'recycling',
    'account',
  ],
  client: [
    'dashboard',
    'plants',
    'inspections',
    'reports',
    'maintenance',
    'partners',
    'recycling',
    'account',
  ],
};
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function readWorkspaceLocation(
  search: string,
  role: string,
): WorkspaceLocation {
  const params = new URLSearchParams(search);
  const view = params.getAll('view').length === 1 ? params.get('view') : null;
  const id =
    params.getAll('inspection').length === 1
      ? params.get('inspection') || ''
      : '';
  return {
    view: (Object.hasOwn(roleViews, role) ? roleViews[role] : []).includes(
      view as WorkspaceView,
    )
      ? (view as WorkspaceView)
      : 'dashboard',
    inspectionId: uuid.test(id) ? id.toLowerCase() : '',
  };
}
export function workspaceHref(path: string, location: WorkspaceLocation) {
  const params = new URLSearchParams();
  params.set('view', location.view);
  if (uuid.test(location.inspectionId))
    params.set('inspection', location.inspectionId.toLowerCase());
  return `${path}?${params}`;
}

/** Per-mounted-workspace history snapshot; contains no account data, drafts or files. */
export function createWorkspaceLocationStore(role: string) {
  const initial = { ...readWorkspaceLocation('', role), ready: false };
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (location: WorkspaceLocation) => {
      const safe = readWorkspaceLocation(
        workspaceHref('', location).slice(1),
        role,
      );
      if (
        snapshot.ready &&
        snapshot.view === safe.view &&
        snapshot.inspectionId === safe.inspectionId
      )
        return;
      snapshot = { ...safe, ready: true };
      for (const listener of listeners) listener();
    },
  };
}
