// Project initial tile (DESIGN.md 侧栏 项目): colors cycle --project-tile-1..6
// by row order. Consumed by the sidebar's expanded and rail rows; the
// project-avatar class is an e2e carrier.

import { cn } from 'cn';

const TILE_BG = [
  'bg-project-tile-1',
  'bg-project-tile-2',
  'bg-project-tile-3',
  'bg-project-tile-4',
  'bg-project-tile-5',
  'bg-project-tile-6',
] as const;

export function ProjectAvatar({
  name,
  tone,
  className,
}: {
  name: string;
  /** Row index; the tile color repeats every six rows. */
  tone: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'project-avatar grid size-4.5 flex-none place-items-center rounded-(--radius-control) text-caption leading-none font-semibold text-(--text-on-accent)',
        TILE_BG[tone % TILE_BG.length],
        className,
      )}
    >
      {Array.from(name.trim())[0]?.toUpperCase() ?? ''}
    </span>
  );
}
