import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './supabase/database.types';
import {
  auditTargetKey,
  type AuditContext,
  type AuditEntry,
} from './audit-display';

/** Resolve only ids from the currently authorized 100 events, through existing RLS. No metadata or contact details. */
export async function loadAuditContext(
  client: SupabaseClient<Database>,
  org: string,
  rows: AuditEntry[],
  signal: AbortSignal,
): Promise<AuditContext> {
  const context: AuditContext = { actors: {}, targets: {}, partial: false };
  const ids = (kind: string) => [
    ...new Set(
      rows
        .filter((r) => r.entity_type === kind && r.entity_id)
        .map((r) => r.entity_id!),
    ),
  ];
  async function load<Row extends { id: string }>(
    kind: string,
    query: (
      values: string[],
    ) => PromiseLike<{ data: Row[] | null; error: unknown }>,
    label: (r: Row) => string,
  ) {
    const values = ids(kind);
    if (!values.length) return;
    try {
      const { data, error } = await query(values);
      if (error) throw error;
      for (const value of data || []) {
        const row = value;
        context.targets[auditTargetKey(kind, String(row.id))] = label(
          row,
        ).slice(0, 200);
      }
    } catch {
      context.partial = true;
    }
  }
  const userIds = [
    ...new Set(
      rows
        .flatMap((r) => [
          r.actor_user_id,
          r.entity_type === 'organization_member' || r.entity_type === 'profile'
            ? r.entity_id
            : null,
        ])
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  await Promise.all([
    (async () => {
      if (!userIds.length) return;
      try {
        const { data, error } = await client
          .from('profiles')
          .select('user_id,display_name')
          .in('user_id', userIds)
          .abortSignal(signal);
        if (error) throw error;
        for (const p of data || [])
          if (p.display_name?.trim()) {
            context.actors[p.user_id] = p.display_name.trim().slice(0, 80);
            context.targets[auditTargetKey('organization_member', p.user_id)] =
              '사용자 · ' + context.actors[p.user_id];
            context.targets[auditTargetKey('profile', p.user_id)] =
              '계정 정보 · ' + context.actors[p.user_id];
          }
      } catch {
        context.partial = true;
      }
    })(),
    load(
      'plant',
      (v) =>
        client
          .from('plants')
          .select('id,name')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) => '발전소 · ' + r.name,
    ),
    load(
      'inspection',
      (v) =>
        client
          .from('inspections')
          .select('id,inspection_code')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) => '점검 · ' + r.inspection_code,
    ),
    load(
      'report',
      (v) =>
        client
          .from('reports')
          .select('id,title')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) => '보고서 · ' + r.title,
    ),
    load(
      'finding',
      (v) =>
        client
          .from('findings')
          .select('id,location_label')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) =>
        '소견·후보 · ' +
        (r.location_label || '기록 ' + String(r.id).slice(0, 8)),
    ),
    load(
      'inspection_file',
      (v) =>
        client
          .from('inspection_files')
          .select('id,original_name')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) => '점검 원본 · ' + r.original_name,
    ),
    load(
      'report_image',
      (v) =>
        client
          .from('report_images')
          .select('id,caption')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) =>
        '보고서 사진 · ' + (r.caption || '기록 ' + String(r.id).slice(0, 8)),
    ),
    load(
      'calculation_settings',
      (v) =>
        client
          .from('calculation_settings')
          .select('id,version')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) => `계산·촬영 기준 · ${r.version}판`,
    ),
    load(
      'maintenance_request',
      (v) =>
        client
          .from('maintenance_requests')
          .select('id,title')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) => '유지보수 · ' + r.title,
    ),
    load(
      'maintenance',
      (v) =>
        client
          .from('maintenance_requests')
          .select('id,title')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) => '유지보수 · ' + r.title,
    ),
    load(
      'analysis_run',
      (v) =>
        client
          .from('analysis_runs')
          .select('id,inspections(inspection_code)')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) =>
        '사진 분석 · ' +
        ((r.inspections as { inspection_code?: string } | null)
          ?.inspection_code || '기록 ' + String(r.id).slice(0, 8)),
    ),
    load(
      'partner_quote',
      (v) =>
        client
          .from('partner_quotes')
          .select('id,partners(name)')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) =>
        '업체 견적 · ' +
        ((r.partners as { name?: string } | null)?.name ||
          '기록 ' + String(r.id).slice(0, 8)),
    ),
    load(
      'partner',
      (v) =>
        client
          .from('partners')
          .select('id,name')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) => '업체 · ' + r.name,
    ),
    load(
      'quote_request',
      (v) =>
        client
          .from('quote_requests')
          .select('id,title')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) => '견적 요청 · ' + r.title,
    ),
    load(
      'recycling_certificate',
      (v) =>
        client
          .from('recycling_certificates')
          .select('id,title')
          .eq('organization_id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) => '재활용 인증서 · ' + r.title,
    ),
    load(
      'organization',
      (v) =>
        client
          .from('organizations')
          .select('id,name')
          .eq('id', org)
          .in('id', v)
          .abortSignal(signal),
      (r) => '작업공간 · ' + r.name,
    ),
  ]);
  return context;
}
