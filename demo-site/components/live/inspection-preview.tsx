'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ImageIcon, Loader2 } from 'lucide-react';
import type { Database } from '@/lib/supabase/database.types';
import {
  loadInspectionPreview,
  type PreviewSource,
} from '@/lib/inspection-preview';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function InspectionPreviewButton({
  client,
  source,
}: {
  client: SupabaseClient<Database>;
  source: PreviewSource;
}) {
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null),
    imageUrl = useRef('');
  function clear() {
    controller.current?.abort();
    controller.current = null;
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = '';
    setUrl('');
  }
  useEffect(
    () => () => {
      controller.current?.abort();
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    },
    [],
  );
  async function show() {
    clear();
    setError('');
    setOpen(true);
    setLoading(true);
    const pending = new AbortController();
    controller.current = pending;
    try {
      const blob = await loadInspectionPreview(client, source, pending.signal);
      if (pending.signal.aborted) return;
      imageUrl.current = URL.createObjectURL(blob);
      setUrl(imageUrl.current);
    } catch (e) {
      if (!pending.signal.aborted)
        setError(
          e instanceof Error ? e.message : '사진을 불러오지 못했습니다.',
        );
    } finally {
      if (!pending.signal.aborted) setLoading(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 sm:min-h-7"
        onClick={() => void show()}
      >
        <ImageIcon />
        미리보기
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) clear();
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="break-all">
              {source.original_name}
            </DialogTitle>
            <DialogDescription>
              화면용 사진입니다. 원본은 ‘원본 다운로드’로 받을 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          {loading && (
            <output className="flex items-center gap-2 py-8">
              <Loader2 className="size-4 animate-spin" />
              사진을 준비하는 중…
            </output>
          )}
          {error && (
            <p role="alert" className="text-rose-700">
              {error}
            </p>
          )}
          {url && (
            <Image
              unoptimized
              src={url}
              alt={`${source.original_name} 미리보기`}
              width={960}
              height={768}
              className="h-auto max-h-[65svh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
