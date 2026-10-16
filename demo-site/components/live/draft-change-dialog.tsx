'use client';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import type { useGuardedAction } from '@/lib/use-guarded-action';

export function DraftChangeDialog({
  guard,
}: {
  guard: ReturnType<typeof useGuardedAction>;
}) {
  return (
    <>
      {guard.blocked && (
        <p
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          저장 결과를 확인하는 중입니다. 완료 후 변경해 주세요.
        </p>
      )}
      <AlertDialog
        open={guard.pending}
        onOpenChange={(open) => {
          if (!open) guard.cancel();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>작성 중인 내용을 버릴까요?</AlertDialogTitle>
            <AlertDialogDescription>
              저장하지 않은 입력이 있습니다. 변경하면 해당 편집 내용이
              사라집니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={guard.cancel}>이어서 작성</AlertDialogCancel>
            <Button type="button" onClick={guard.confirm}>
              저장하지 않고 변경
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
