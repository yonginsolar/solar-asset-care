/** Display only: never round a positive payback interval down to zero years. */
export function formatPaybackYears(years: number | null) {
  if (years === null) return '산출 불가 (회수가능액 0)';
  if (!Number.isFinite(years) || years < 0) return '산출 불가';
  if (years === 0) return '즉시 (수리비 0원)';
  if (years < 1 / 12) return '1개월 미만';
  const value = years < 1 ? years * 12 : years;
  return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}${years < 1 ? '개월' : '년'}`;
}
