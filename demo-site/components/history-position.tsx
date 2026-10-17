'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { trackHistoryPosition } from '@/lib/history-position';

export function HistoryPositionTracking() {
  const pathname = usePathname();
  useEffect(() => {
    trackHistoryPosition(window).sync();
  }, [pathname]);
  return null;
}
