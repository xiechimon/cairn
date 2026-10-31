import { cn } from 'cn';
import { SpiralMark } from '../../chief/chief-fab-icon.js';
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
      <span data-tone={tone} className={cn('inline-flex size-3.5 flex-none', className)}>
        <SpiralMark busy={!still} className="size-full text-running" />
      </span>
    );
  }
  const { kind, ink } = TONE_GLYPH[tone];
  return <StatusGlyph kind={kind} className={cn(ink, className)} />;
}
