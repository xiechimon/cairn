import type { ProjectIcon } from '@cairn/shared';
import { cn } from 'cn';
import { Archive, Box, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import { PROJECT_ICON_COMPONENTS } from '../../board/project-icon-map.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';

export type TreePlace = 'only' | 'first' | 'middle' | 'last';

export interface SidebarProjectRowProps {
  name: string;
  icon?: ProjectIcon | null | undefined;
  active?: boolean;
  place?: TreePlace;
  waiting?: string | null;
  status?: string | null;
  archived?: string | null;
  flat?: boolean;
  onClick?: () => void;
  menu?: ReactNode;
}

export const SIDEBAR_ROW =
  'h-8.5 w-full justify-start gap-3 rounded-(--cds-radius-md) border-none text-ui font-normal pointer-coarse:h-11';

export const SIDEBAR_ROW_ACTION =
  'size-5.5 rounded-(--cds-radius-md) p-0 text-foreground hover:bg-(--sidebar-press) aria-expanded:bg-(--sidebar-press) dark:hover:bg-(--sidebar-press) pointer-coarse:size-11 [&_svg:not([class*=size-])]:size-4 pointer-coarse:[&_svg:not([class*=size-])]:size-5';

const ACTION_SLOT =
  'absolute top-1/2 right-1 -translate-y-1/2 items-center gap-0.5 group-focus-within/row:inline-flex group-hover/row:inline-flex has-aria-expanded:inline-flex [@media(hover:none)]:inline-flex';

const REVEAL_PAD =
  'group-focus-within/row:pr-8 group-hover/row:pr-8 group-has-aria-expanded/row:pr-8 [@media(hover:none)]:pr-12';

const HIDE_ON_REVEAL =
  '[@media(hover:hover)]:group-focus-within/row:invisible [@media(hover:hover)]:group-hover/row:invisible [@media(hover:hover)]:group-has-aria-expanded/row:invisible';

const TAG_HIDE_ON_REVEAL =
  '[@media(hover:hover)]:group-focus-within/row:hidden [@media(hover:hover)]:group-hover/row:hidden [@media(hover:hover)]:group-has-aria-expanded/row:hidden';

const ROW_FILL =
  'group-hover/row:bg-sidebar-hover group-has-aria-expanded/row:bg-sidebar-hover dark:group-hover/row:bg-sidebar-hover';

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
  const Glyph = (icon != null && PROJECT_ICON_COMPONENTS[icon]) || Box;
  return (
    <Glyph
      data-slot="project-glyph"
      data-project-icon={icon ?? undefined}
      className="size-5 flex-none text-sidebar-ink"
      strokeWidth={1.75}
    />
  );
}

export function TreeGuide({ place }: { place: TreePlace }) {
  const first = place === 'only' || place === 'first';
  const last = place === 'only' || place === 'last';
  return (
    <>
      {!last && (
        <span
          aria-hidden
          data-slot="tree-guide"
          className={cn(
            'pointer-events-none absolute -left-2 bottom-0 w-px bg-(--tree-line) pointer-coarse:hidden',
            first ? 'top-1.25' : '-top-0.5',
          )}
        />
      )}
      <span
        aria-hidden
        data-slot="tree-guide"
        className={cn(
          'pointer-events-none absolute -left-2 w-2 rounded-bl-(--cds-radius-sm) border-b border-l border-(--tree-line) pointer-coarse:hidden',
          first ? 'top-1.25 h-3' : '-top-0.5 h-4.75',
        )}
      />
    </>
  );
}

export function SidebarRowActions({
  children,
  pinned = false,
}: {
  children: ReactNode;
  pinned?: boolean;
}) {
  return <span className={cn(ACTION_SLOT, pinned ? 'inline-flex' : 'hidden')}>{children}</span>;
}

export function SidebarProjectRow({
  name,
  icon,
  active = false,
  place = 'only',
  waiting = null,
  status = null,
  archived = null,
  flat = false,
  onClick,
  menu,
}: SidebarProjectRowProps) {
  const button = (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-description={status ?? archived ?? undefined}
      data-slot="sidebar-project-row"
      data-archived={archived != null ? '' : undefined}
      className={cn(
        SIDEBAR_ROW,
        flat ? 'pr-2 pl-1.5' : 'pr-2 pl-2.5',
        active
          ? 'bg-(--sidebar-active) text-foreground hover:bg-(--sidebar-active) dark:hover:bg-(--sidebar-active)'
          : cn(
              archived != null ? 'text-content-secondary' : 'text-foreground',
              'hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-sidebar-hover',
              ROW_FILL,
            ),
        menu != null && REVEAL_PAD,
      )}
    >
      <ProjectGlyph icon={icon} />
      <span className="min-w-0 flex-1 truncate text-left" title={name}>
        {name}
      </span>
      {archived != null && (
        <span
          aria-hidden
          data-slot="archived-tag"
          className={cn(
            flat
              ? 'inline-flex h-5 flex-none items-center gap-1.5 rounded-full border border-border px-2 text-caption text-content-secondary'
              : 'grid size-5.5 flex-none place-items-center rounded-full border border-border text-content-secondary',
            menu != null && TAG_HIDE_ON_REVEAL,
            flat && menu != null && '[@media(hover:none)]:hidden',
          )}
        >
          <Archive className="size-4" strokeWidth={1.75} />
          {flat && archived}
        </span>
      )}
      {waiting != null && (
        <span
          role="img"
          aria-label={waiting}
          data-slot="needs-you-dot"
          className={cn(
            'mr-0.5 size-1.5 flex-none rounded-full bg-(--card-button)',
            menu != null && HIDE_ON_REVEAL,
          )}
        />
      )}
    </Button>
  );
  return (
    <div className={cn('group/row relative flex flex-none', !flat && 'ml-5.5')}>
      {!flat && <TreeGuide place={place} />}
      {(status ?? archived) === null ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger render={button} />
          <TooltipContent side="right" sideOffset={8}>
            {status ?? archived}
          </TooltipContent>
        </Tooltip>
      )}
      {menu != null && <SidebarRowActions>{menu}</SidebarRowActions>}
    </div>
  );
}

export function SidebarProjectRowSkeleton({ place }: { place: TreePlace }) {
  return (
    <div className="relative ml-5.5 flex flex-none">
      <TreeGuide place={place} />
      <div className={cn(SIDEBAR_ROW, 'flex items-center pr-2 pl-2.5')}>
        <Skeleton className="size-5 flex-none" />
        <Skeleton className="h-3.5 w-28" />
      </div>
    </div>
  );
}

export function SidebarProjectGroupHeader({
  name,
  expanded,
  count,
  waiting = null,
  spaced = false,
  onToggle,
  menu,
}: {
  name: string;
  expanded: boolean;
  count: number;
  waiting?: string | null;
  spaced?: boolean;
  onToggle: () => void;
  menu?: ReactNode;
}) {
  return (
    <div className={cn('group/row relative flex flex-none', spaced && 'mt-4')}>
      <Button
        variant="ghost"
        data-testid="project-group-header"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          SIDEBAR_ROW,
          'h-6.5 cursor-pointer pr-2 pl-1.5 text-foreground hover:bg-sidebar-hover aria-expanded:bg-transparent aria-expanded:hover:bg-sidebar-hover dark:hover:bg-sidebar-hover',
          ROW_FILL,
          menu != null && REVEAL_PAD,
        )}
      >
        <Folder className="size-5 flex-none text-sidebar-ink" strokeWidth={1.75} />
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate">{name}</span>
          {expanded ? (
            <ChevronDown
              aria-hidden
              className="size-4 flex-none text-content-tertiary"
              strokeWidth={1.75}
            />
          ) : (
            <>
              <ChevronRight
                aria-hidden
                className="size-4 flex-none text-content-tertiary"
                strokeWidth={1.75}
              />
              <span data-slot="group-count" className="text-content-tertiary tabular-nums">
                {count}
              </span>
            </>
          )}
        </span>
        {!expanded && waiting != null && (
          <span
            role="img"
            aria-label={waiting}
            data-slot="needs-you-dot"
            className={cn(
              'mr-0.5 ml-auto size-1.5 flex-none rounded-full bg-(--card-button)',
              menu != null && HIDE_ON_REVEAL,
            )}
          />
        )}
      </Button>
      {menu != null && <SidebarRowActions>{menu}</SidebarRowActions>}
    </div>
  );
}
