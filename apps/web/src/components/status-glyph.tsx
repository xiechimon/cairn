import { cn } from 'cn';
import { useId } from 'react';

export type GlyphKind =
  | 'todo'
  | 'queued'
  | 'ring'
  | 'working'
  | 'progress'
  | 'attention'
  | 'quarter'
  | 'half'
  | 'three-quarter'
  | 'done'
  | 'failed'
  | 'closed';

const RING = { cx: 7, cy: 7, r: 5.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 };

const PIE: Partial<Record<GlyphKind, string>> = {
  quarter: 'M7 7V3.2A3.8 3.8 0 0 1 10.8 7Z',
  half: 'M7 7V3.2A3.8 3.8 0 0 1 7 10.8Z',
  'three-quarter': 'M7 7V3.2A3.8 3.8 0 1 1 3.2 7Z',
};

const CUT: Partial<Record<GlyphKind, string>> = {
  done: 'M4.4 7.1 6.2 8.9 9.6 5.3',
  failed: 'M5 5l4 4M9 5 5 9',
  closed: 'M4.6 9.4 9.4 4.6',
};

export function StatusGlyph({
  kind,
  label,
  className,
  outlined = false,
}: {
  kind: GlyphKind;
  label?: string;
  className?: string;
  outlined?: boolean;
}) {
  const maskId = useId();
  const cut = outlined && kind === 'failed' ? undefined : CUT[kind];
  const pie = PIE[kind];
  return (
    <svg
      viewBox="0 0 14 14"
      data-glyph={kind}
      role={label == null ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label == null ? true : undefined}
      className={cn('size-4 flex-none', className)}
    >
      {cut != null ? (
        <>
          <mask id={maskId}>
            <circle cx="7" cy="7" r="6.25" fill="white" />
            <path
              d={cut}
              fill="none"
              stroke="black"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </mask>
          <circle cx="7" cy="7" r="6.25" fill="currentColor" mask={`url(#${maskId})`} />
        </>
      ) : (
        <>
          {kind !== 'progress' && (
            <circle
              {...RING}
              strokeDasharray={kind === 'todo' ? '2.2 2' : undefined}
              opacity={kind === 'working' ? 0.25 : undefined}
            />
          )}
          {kind === 'working' && (
            <path
              className="glyph-working origin-center motion-safe:animate-spin"
              d="M7 1.5A5.5 5.5 0 0 1 12.5 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          )}
          {kind === 'progress' && (
            <circle
              {...RING}
              className="origin-center motion-safe:animate-spin"
              strokeDasharray="25.9 8.7"
              strokeLinecap="round"
            />
          )}
          {kind === 'attention' && <circle cx="7" cy="7" r="1.7" fill="currentColor" />}
          {kind === 'queued' && (
            <path
              d="M7 4.2V7l1.8 1.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          )}
          {pie != null && <path d={pie} fill="currentColor" />}
          {outlined && kind === 'failed' && (
            <path
              d={CUT.failed}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          )}
        </>
      )}
    </svg>
  );
}
