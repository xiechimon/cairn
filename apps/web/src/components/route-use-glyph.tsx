import type { RouteUse } from '@cairn/shared';
import { cn } from 'cn';
import { Eye, ListChecks, type LucideIcon, Shrink } from 'lucide-react';
import { BrandGlyph } from './brand-glyph.js';

const USE_GLYPHS: Record<Exclude<RouteUse, 'coordinator'>, LucideIcon> = {
  session: ListChecks,
  review: Eye,
  compaction: Shrink,
};

export function RouteUseGlyph({
  use,
  className = 'size-4',
}: {
  use: RouteUse;
  className?: string;
}) {
  if (use === 'coordinator')
    return <BrandGlyph data-route-glyph={use} className={cn('flex-none', className)} />;
  const Glyph = USE_GLYPHS[use];
  return (
    <Glyph
      aria-hidden
      data-route-glyph={use}
      strokeWidth={1.75}
      className={cn('flex-none text-icon', className)}
    />
  );
}
