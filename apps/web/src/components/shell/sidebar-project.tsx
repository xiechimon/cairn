import type { ProjectIcon } from '@cairn/shared';
import { cn } from 'cn';
import { AlarmClockOff, ChevronDown, Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import { PROJECT_ICON_COMPONENTS } from '../../board/project-icon-map.js';
import { ACCENT_INK } from '../../phase.js';
import { type GlyphKind, StatusGlyph } from '../status-glyph.js';
import { Button } from '../ui/button.js';

export interface SidebarProjectRowProps {
  name: string;
  icon?: ProjectIcon | null | undefined;
  active?: boolean;
  muted?: boolean;
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
  muted = false,
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
        muted && !active && 'text-content-tertiary',
        menu != null && 'pr-8',
      )}
    >
      <ProjectGlyph icon={icon} />
      <span className="min-w-0 truncate">{name}</span>
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

export type SidebarThreadState = 'needs-you' | 'running' | 'idle' | 'done' | 'failed';

const STATE_GLYPH: Record<SidebarThreadState, { kind: GlyphKind; ink: string }> = {
  'needs-you': { kind: 'half', ink: ACCENT_INK },
  running: { kind: 'working', ink: 'text-content-secondary' },
  idle: { kind: 'todo', ink: 'text-content-tertiary' },
  done: { kind: 'done', ink: 'text-content-dim' },
  failed: { kind: 'failed', ink: 'text-content-tertiary' },
};

export interface SidebarThreadRowProps {
  title: string;
  state: SidebarThreadState;
  open?: boolean;
  snoozed?: boolean;
  tag?: string;
  elapsed?: string | null;
  hoverTime?: string | null;
  tooltip?: string;
  onClick?: () => void;
}

export function SidebarThreadRow({
  title,
  state,
  open = false,
  snoozed = false,
  tag,
  elapsed,
  hoverTime,
  tooltip,
  onClick,
}: SidebarThreadRowProps) {
  const glyph = STATE_GLYPH[state];
  const lifted = state === 'running' && !open;
  return (
    <div
      data-slot="sidebar-thread-row"
      data-state={state}
      data-open={open ? '' : undefined}
      className={cn(
        'group/thread relative flex h-7 items-center rounded-(--radius-control)',
        open && 'bg-sidebar-hover text-foreground',
        lifted && 'bg-card shadow-(--e1)',
        !open && !lifted && 'hover:bg-sidebar-hover',
      )}
    >
      <Button
        variant="ghost"
        onClick={onClick}
        aria-current={open ? 'true' : undefined}
        title={tooltip}
        className={cn(
          'h-7 min-w-0 flex-1 justify-start gap-2 px-2 text-ui font-normal hover:bg-transparent dark:hover:bg-transparent',
          snoozed || state === 'done' ? 'text-content-tertiary' : 'text-content-secondary',
          (open || state === 'needs-you' || state === 'running') && 'text-foreground',
        )}
      >
        {snoozed ? (
          <AlarmClockOff className="size-3.5 flex-none text-content-tertiary" strokeWidth={1.75} />
        ) : (
          <StatusGlyph kind={glyph.kind} className={glyph.ink} />
        )}
        <span data-slot="sidebar-thread-title" className="min-w-0 flex-1 truncate text-left">
          {title}
        </span>
      </Button>
      {tag != null && (
        <span
          data-slot="sidebar-thread-tag"
          className="mr-2 flex-none rounded-sm bg-foreground/6 px-1.5 text-caption leading-4 text-content-secondary"
        >
          {tag}
        </span>
      )}
      {elapsed != null && (
        <span
          data-slot="sidebar-thread-meta"
          className="mr-2 flex-none text-caption text-content-tertiary tabular-nums"
        >
          {elapsed}
        </span>
      )}
      {hoverTime != null && (
        <span
          data-slot="sidebar-thread-hover-time"
          className="pointer-events-none absolute top-1/2 right-0 hidden -translate-y-1/2 rounded-r-(--radius-control) bg-sidebar-hover pr-2 pl-2 text-caption text-content-tertiary tabular-nums group-focus-within/thread:inline group-hover/thread:inline"
        >
          {hoverTime}
        </span>
      )}
    </div>
  );
}

export function SidebarGroupHeader({
  label,
  count,
  accent = false,
  expanded,
  onToggle,
  testId,
}: {
  label: string;
  count: number;
  accent?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  testId?: string;
}) {
  const body = (
    <>
      {label}
      <span className="tabular-nums">{count}</span>
      {expanded !== undefined && (
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3 text-content-dim transition-transform duration-150',
            !expanded && '-rotate-90',
          )}
          strokeWidth={1.75}
        />
      )}
    </>
  );
  const className = cn(
    'flex h-6 w-full items-center justify-start gap-1.5 pr-1 pl-2.5 text-caption font-medium',
    accent ? 'text-foreground' : 'text-content-tertiary',
  );
  if (onToggle === undefined) {
    return (
      <div data-testid={testId} className={className}>
        {body}
      </div>
    );
  }
  return (
    <Button
      variant="ghost"
      data-testid={testId}
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        className,
        'h-6 cursor-pointer rounded-(--radius-control) border-none bg-transparent hover:bg-transparent hover:text-content-secondary dark:hover:bg-transparent',
      )}
    >
      {body}
    </Button>
  );
}
