export type ImageRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function regionFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  minimumSize = 0.005,
): ImageRegion | null {
  const startX = clamp(start.x);
  const startY = clamp(start.y);
  const endX = clamp(end.x);
  const endY = clamp(end.y);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  if (width < minimumSize || height < minimumSize) return null;
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width,
    height,
  };
}

export function validImageRegion(value: unknown): value is ImageRegion {
  if (!value || typeof value !== 'object') return false;
  const region = value as Partial<ImageRegion>;
  return (
    [region.x, region.y, region.width, region.height].every(
      (part) => typeof part === 'number' && Number.isFinite(part),
    ) &&
    region.x! >= 0 &&
    region.y! >= 0 &&
    region.width! > 0 &&
    region.height! > 0 &&
    region.x! + region.width! <= 1 &&
    region.y! + region.height! <= 1
  );
}
