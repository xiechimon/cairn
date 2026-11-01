import { cn } from 'cn';
import { ACCENT_INK } from '../../phase.js';
import { type GlyphKind, StatusGlyph } from '../status-glyph.js';
import type { StoneTone } from './tone.js';

const TONE_GLYPH: Record<Exclude<StoneTone, 'working'>, { kind: GlyphKind; ink: string }> = {
  waiting: { kind: 'half', ink: ACCENT_INK },
  review: { kind: 'three-quarter', ink: ACCENT_INK },
  idle: { kind: 'ring', ink: 'text-content-tertiary' },
  resolved: { kind: 'done', ink: 'text-content-dim' },
};

export function ToneGlyph({
  tone,
  still = false,
  className,
}: {
  tone: StoneTone;
  still?: boolean;
  className?: string;
}) {
  if (tone === 'working') {
    return (
      <StatusGlyph
        kind="working"
        className={cn('text-running', still && '[&_.glyph-working]:animate-none', className)}
      />
    );
  }
  const { kind, ink } = TONE_GLYPH[tone];
  return <StatusGlyph kind={kind} className={cn(ink, className)} />;
}
