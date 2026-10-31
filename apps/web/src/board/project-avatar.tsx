import { cn } from 'cn';

const TILE_SKIN = [
  'bg-project-tile-1/18 text-project-ink-1 ring-project-tile-1/30',
  'bg-project-tile-2/18 text-project-ink-2 ring-project-tile-2/30',
  'bg-project-tile-3/18 text-project-ink-3 ring-project-tile-3/30',
  'bg-project-tile-4/18 text-project-ink-4 ring-project-tile-4/30',
  'bg-project-tile-5/18 text-project-ink-5 ring-project-tile-5/30',
  'bg-project-tile-6/18 text-project-ink-6 ring-project-tile-6/30',
] as const;

export function ProjectAvatar({
  name,
  tone,
  className,
}: {
  name: string;
  tone: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'project-avatar grid size-4.5 flex-none place-items-center rounded-(--cds-radius-md) text-caption leading-none font-semibold ring-1 ring-inset',
        TILE_SKIN[tone % TILE_SKIN.length],
        className,
      )}
    >
      {Array.from(name.trim())[0]?.toUpperCase() ?? ''}
    </span>
  );
}
