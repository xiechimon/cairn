import type { ProjectColor, ProjectIcon } from '@cairn/shared';
import { cn } from 'cn';
import { PROJECT_ICON_COMPONENTS } from './project-icon-map.js';

const TILE_SKIN = [
  'bg-project-tile-1/18 text-project-ink-1 ring-project-tile-1/30',
  'bg-project-tile-2/18 text-project-ink-2 ring-project-tile-2/30',
  'bg-project-tile-3/18 text-project-ink-3 ring-project-tile-3/30',
  'bg-project-tile-4/18 text-project-ink-4 ring-project-tile-4/30',
  'bg-project-tile-5/18 text-project-ink-5 ring-project-tile-5/30',
  'bg-project-tile-6/18 text-project-ink-6 ring-project-tile-6/30',
] as const;
const GRAY_SKIN = 'bg-content-tertiary/18 text-content-tertiary ring-content-tertiary/30';

const COLOR_INK: Record<ProjectColor, string> = {
  moss: 'text-project-ink-1',
  amber: 'text-project-ink-2',
  slate: 'text-project-ink-3',
  plum: 'text-project-ink-4',
  teal: 'text-project-ink-5',
  rose: 'text-project-ink-6',
  gray: 'text-content-tertiary',
};

const NEUTRAL_TILE = 'bg-foreground/8 text-content-secondary';

const ICON_TILE: Record<ProjectColor, string> = {
  moss: 'bg-project-tile-1/16 text-project-ink-1',
  amber: 'bg-project-tile-2/16 text-project-ink-2',
  slate: 'bg-project-tile-3/16 text-project-ink-3',
  plum: 'bg-project-tile-4/16 text-project-ink-4',
  teal: 'bg-project-tile-5/16 text-project-ink-5',
  rose: 'bg-project-tile-6/16 text-project-ink-6',
  gray: 'bg-content-tertiary/16 text-content-tertiary',
};

export const PROJECT_COLOR_SWATCH: Record<ProjectColor, string> = {
  moss: 'bg-project-ink-1 hover:bg-project-ink-1 dark:hover:bg-project-ink-1',
  amber: 'bg-project-ink-2 hover:bg-project-ink-2 dark:hover:bg-project-ink-2',
  slate: 'bg-project-ink-3 hover:bg-project-ink-3 dark:hover:bg-project-ink-3',
  plum: 'bg-project-ink-4 hover:bg-project-ink-4 dark:hover:bg-project-ink-4',
  teal: 'bg-project-ink-5 hover:bg-project-ink-5 dark:hover:bg-project-ink-5',
  rose: 'bg-project-ink-6 hover:bg-project-ink-6 dark:hover:bg-project-ink-6',
  gray: 'bg-content-tertiary hover:bg-content-tertiary dark:hover:bg-content-tertiary',
};

const COLOR_TONE: Record<ProjectColor, number | null> = {
  moss: 0,
  amber: 1,
  slate: 2,
  plum: 3,
  teal: 4,
  rose: 5,
  gray: null,
};

export function ProjectAvatar({
  name,
  tone,
  icon,
  color,
  bare = false,
  className,
}: {
  name: string;
  tone: number;
  icon?: ProjectIcon | null | undefined;
  color?: ProjectColor | null | undefined;
  bare?: boolean;
  className?: string;
}) {
  if (icon != null) {
    const Icon = PROJECT_ICON_COMPONENTS[icon];
    return (
      <span
        aria-hidden="true"
        data-project-icon={icon}
        data-project-color={color ?? 'none'}
        className={cn(
          'project-avatar grid flex-none place-items-center',
          bare
            ? ['size-4', color != null && COLOR_INK[color]]
            : [
                'size-8 rounded-lg [&>svg]:size-1/2',
                color != null ? ICON_TILE[color] : NEUTRAL_TILE,
              ],
          className,
        )}
      >
        <Icon className={bare ? 'size-4' : undefined} strokeWidth={bare ? 1.75 : 1.5} />
      </span>
    );
  }
  const colorTone = color != null ? COLOR_TONE[color] : null;
  const skin = color === 'gray' ? GRAY_SKIN : TILE_SKIN[(colorTone ?? tone) % TILE_SKIN.length];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'project-avatar grid size-4.5 flex-none place-items-center rounded-(--cds-radius-md) text-caption leading-none font-semibold ring-1 ring-inset',
        skin,
        className,
      )}
    >
      {Array.from(name.trim())[0]?.toUpperCase() ?? ''}
    </span>
  );
}
