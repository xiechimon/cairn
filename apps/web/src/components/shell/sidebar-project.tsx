import type { ProjectIcon } from '@cairn/shared';
import { cn } from 'cn';
import { ChevronDown, Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import { PROJECT_ICON_COMPONENTS } from '../../board/project-icon-map.js';
import { Button } from '../ui/button.js';

export interface SidebarProjectRowProps {
  name: string;
  icon?: ProjectIcon | null | undefined;
  active?: boolean;
  nested?: boolean;
  waiting?: string | null;
  onClick?: () => void;
  menu?: ReactNode;
}

export function ProjectGlyph({
  icon,
  name,
}: {
  icon?: ProjectIcon | null | undefined;
  name?: string;
}) {
  if (icon == null && name !== undefined) {
    return (
      <span
        aria-hidden
        data-slot="project-glyph"
        className="grid size-4 flex-none place-items-center text-ui font-medium text-content-secondary"
      >
        {Array.from(name.trim())[0]?.toUpperCase()}
      </span>
    );
  }
  const Glyph = (icon != null && PROJECT_ICON_COMPONENTS[icon]) || Folder;
  return (
    <Glyph
      data-slot="project-glyph"
      data-project-icon={icon ?? undefined}
      className="size-4 flex-none text-content-tertiary"
      strokeWidth={1.75}
    />
  );
}

export function SidebarProjectRow({
  name,
  icon,
  active = false,
  nested = false,
  waiting = null,
  onClick,
  menu,
}: SidebarProjectRowProps) {
  const button = (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      data-slot="sidebar-project-row"
      className={cn(
        'h-8 w-full justify-start gap-2.5 px-2 text-ui font-normal',
        active
          ? 'font-semibold text-foreground hover:bg-sidebar-hover dark:hover:bg-sidebar-hover'
          : 'text-content-secondary hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-sidebar-hover',
        nested && 'pl-6',
        menu != null &&
          'group-focus-within/project:pr-8 group-hover/project:pr-8 group-has-aria-expanded/project:pr-8 [@media(hover:none)]:pr-8',
      )}
    >
      <ProjectGlyph icon={icon} />
      <span className="min-w-0 flex-1 truncate text-left" title={name}>
        {name}
      </span>
      {waiting != null && (
        <span
          role="img"
          aria-label={waiting}
          data-slot="needs-you-dot"
          className={cn(
            'size-1.5 flex-none rounded-full bg-(--card-button)',
            menu != null &&
              '[@media(hover:hover)]:group-focus-within/project:invisible [@media(hover:hover)]:group-hover/project:invisible [@media(hover:hover)]:group-has-aria-expanded/project:invisible',
          )}
        />
      )}
    </Button>
  );
  if (menu == null) return button;
  return (
    <div className="group/project relative">
      {button}
      <span className="absolute top-1/2 right-1 hidden -translate-y-1/2 group-focus-within/project:inline-flex group-hover/project:inline-flex has-aria-expanded:inline-flex [@media(hover:none)]:inline-flex">
        {menu}
      </span>
    </div>
  );
}

export function SidebarProjectGroupHeader({
  name,
  expanded,
  onToggle,
}: {
  name: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      data-testid="project-group-header"
      aria-expanded={expanded}
      onClick={onToggle}
      className="mt-3 h-6 w-full cursor-pointer justify-start gap-1 rounded-(--radius-control) border-none bg-transparent pr-1 pl-2.5 text-caption font-medium text-content-tertiary hover:bg-transparent hover:text-content-secondary dark:hover:bg-transparent aria-expanded:bg-transparent"
    >
      <span className="min-w-0 truncate">{name}</span>
      <ChevronDown
        aria-hidden
        className={cn(
          'size-3.5 flex-none text-content-dim transition-transform duration-150',
          !expanded && '-rotate-90',
        )}
        strokeWidth={1.75}
      />
    </Button>
  );
}
