import { type ProjectColor, type ProjectIcon, projectIconOrAuto } from '@cairn/shared';
import { cn } from 'cn';
import { PROJECT_ICON_COMPONENTS } from './project-icon-map.js';

export function ProjectAvatar({
  name,
  icon,
  bare = false,
  className,
}: {
  name?: string;
  tone?: number;
  icon?: ProjectIcon | null | undefined;
  color?: ProjectColor | null | undefined;
  bare?: boolean;
  className?: string;
}) {
  const resolved = projectIconOrAuto(icon, name);
  const auto = icon == null && resolved !== 'box';
  const Icon = PROJECT_ICON_COMPONENTS[resolved];
  const tiled = resolved !== 'box' && !bare;
  return (
    <span
      aria-hidden="true"
      data-project-icon={resolved === 'box' && icon == null ? undefined : resolved}
      data-project-icon-auto={auto || undefined}
      data-project-type={resolved === 'box' && icon == null ? 'box' : undefined}
      className={cn(
        'project-avatar grid flex-none place-items-center text-content-tertiary',
        tiled
          ? 'size-8 rounded-lg bg-foreground/8 text-content-secondary [&>svg]:size-1/2'
          : 'size-5',
        className,
      )}
    >
      <Icon className={tiled ? undefined : 'size-5'} />
    </span>
  );
}
