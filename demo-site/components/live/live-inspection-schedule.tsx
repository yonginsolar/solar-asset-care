'use client';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/lib/supabase/database.types';
import { parseKoreanInput, toKoreanInput } from '@/lib/operational-assessment';
import { useDraftProtection } from '@/lib/use-draft-protection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function InspectionScheduleEditor({
  inspection,
  supabase,
  onClose,
  onSaved,
  onPending,
}: {
  inspection: Tables<'inspections'>;
  supabase: SupabaseClient<Database>;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onPending: (pending: boolean) => void;
}) {
  // Retain the exact edited revision through refresh/failure, never overwrite a draft.
  const [original] = useState(inspection);
  const fieldId = useId();
  const start = original.scheduled_at
    ? toKoreanInput(original.scheduled_at)
    : '';
  const end = original.due_at ? toKoreanInput(original.due_at) : '';
  const [scheduledAt, setScheduledAt] = useState(start);
  const [dueAt, setDueAt] = useState(end);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const dirty = scheduledAt !== start || dueAt !== end;
  useDraftProtection(dirty, busy);
  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !dirty) return;
    lock.current = true;
    setBusy(true);
    onPending(true);
    setError('');
    try {
      const scheduled =
        scheduledAt === start
          ? original.scheduled_at
          : scheduledAt
            ? parseKoreanInput(scheduledAt, '예정 일시')
            : null;
      const due =
        dueAt === end
          ? original.due_at
          : dueAt
            ? parseKoreanInput(dueAt, '완료 목표')
            : null;
      if (scheduled && due && Date.parse(due) < Date.parse(scheduled))
        throw new Error('완료 목표는 예정 일시보다 빠를 수 없습니다.');
      const result = await supabase.rpc('update_inspection_schedule', {
        p_inspection_id: original.id,
        p_expected_updated_at: original.updated_at,
        p_scheduled_at: scheduled,
        p_due_at: due,
      });
      if (result.error) throw result.error;
      await onSaved();
      onClose();
    } catch (reason) {
      setError(
        reason && typeof reason === 'object' && 'message' in reason
          ? String(reason.message)
          : '일정을 저장하지 못했습니다. 입력을 확인해 주세요.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
      onPending(false);
    }
  }
  return (
    <form
      onSubmit={save}
      className="mt-4 min-w-0 space-y-3 rounded-xl border bg-slate-50 p-4"
      aria-label={`${inspection.inspection_code} 일정 수정`}
    >
      <p className="text-sm font-bold">점검 일정 수정 · 한국시간</p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label
          htmlFor={`${fieldId}-start`}
          className="min-w-0 space-y-2 text-sm"
        >
          예정 일시
          <Input
            id={`${fieldId}-start`}
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </label>
        <label htmlFor={`${fieldId}-end`} className="min-w-0 space-y-2 text-sm">
          완료 목표
          <Input
            id={`${fieldId}-end`}
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !dirty}>
          {busy ? '저장 중…' : '일정 저장'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onClose}
        >
          수정 취소
        </Button>
      </div>
    </form>
  );
}
