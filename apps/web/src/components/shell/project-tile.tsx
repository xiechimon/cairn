import { cn } from 'cn';

const TILE_BG = [
  'bg-project-tile-1',
  'bg-project-tile-2',
  'bg-project-tile-3',
  'bg-project-tile-4',
  'bg-project-tile-5',
  'bg-project-tile-6',
] as const;

export interface ProjectTileProps {
  name: string;
  tone: number;
  size?: 'sm' | 'lg';
  className?: string;
}

export function ProjectTile({ name, tone, size = 'sm', className }: ProjectTileProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="project-tile"
      data-size={size}
      className={cn(
        'grid flex-none place-items-center font-semibold text-(--text-on-accent)',
        size === 'sm'
          ? 'size-4.5 rounded-sm text-caption'
          : 'size-9 rounded-(--cds-radius-xl) text-heading',
        TILE_BG[tone % TILE_BG.length],
        className,
      )}
    >
      {Array.from(name.trim())[0]?.toUpperCase() ?? ''}
    </span>
  );
}
