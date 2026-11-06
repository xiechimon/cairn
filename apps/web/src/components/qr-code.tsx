import { useMemo } from 'react';
import { encodeQr, qrPathData } from '../lib/qr-code.js';

const QUIET_ZONE_MODULES = 4;

export function QrCode({ text, label }: { text: string; label: string }) {
  const encoded = useMemo(() => {
    try {
      const matrix = encodeQr(text);
      return { size: matrix.size, path: qrPathData(matrix) };
    } catch {
      return null;
    }
  }, [text]);
  if (encoded === null) return null;
  const span = encoded.size + QUIET_ZONE_MODULES * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-QUIET_ZONE_MODULES} ${-QUIET_ZONE_MODULES} ${span} ${span}`}
      shapeRendering="crispEdges"
      className="size-56 max-w-full rounded-md bg-white"
      data-testid="pair-qr"
    >
      <path d={encoded.path} fill="black" />
    </svg>
  );
}
