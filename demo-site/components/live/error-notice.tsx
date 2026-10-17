'use client';
import { useState, type RefObject } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

/** An error must be visible even when its form was submitted below the fold. */
export function ErrorNotice({
  message,
  identity = message,
  finalFocus,
}: {
  message: string;
  identity?: unknown;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const [dismissed, setDismissed] = useState<unknown>(null);
  return (
    <>
      <p
        role="alert"
        className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
      >
        {message}
      </p>
      <AlertDialog
        open={dismissed !== identity}
        onOpenChange={(open) => {
          if (!open) setDismissed(identity);
        }}
      >
        <AlertDialogContent finalFocus={finalFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>확인이 필요합니다</AlertDialogTitle>
            <AlertDialogDescription>{message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>확인</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
