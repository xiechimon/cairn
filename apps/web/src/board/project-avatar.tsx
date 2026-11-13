import type { ProjectColor, ProjectIcon } from '@cairn/shared';
import { cn } from 'cn';
import { Folder } from 'lucide-react';
import { PROJECT_ICON_COMPONENTS } from './project-icon-map.js';

export function ProjectAvatar({
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
  const Icon = icon != null ? PROJECT_ICON_COMPONENTS[icon] : Folder;
  const tiled = icon != null && !bare;
  return (
    <span
      aria-hidden="true"
      data-project-icon={icon ?? undefined}
      data-project-type={icon == null ? 'folder' : undefined}
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
