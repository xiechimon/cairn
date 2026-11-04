import { cn } from 'cn';
import { Pause, Timer, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { Transcript } from '../detail/transcript.js';
import { FrameTranscript, SideChatFrame } from './proposals-frame.js';
import { LOGIN_TURN } from './proposals-turns.js';

export interface AutomationData {
  cadence: string;
  next?: string;
  last?: string;
  prompt: string;
  enabled: boolean;
  oneTime: boolean;
}

export const AUTOMATION_ACTIVE: AutomationData = {
  cadence: 'Every weekday at 09:00',
  next: 'Next run in 3 hours',
  last: 'Last run 21 hours ago',
  prompt:
    'Re-run the login e2e suite five times on main. If any run fails, open a thread with the trace attached.',
  enabled: true,
  oneTime: false,
};

export const AUTOMATION_FINISHED: AutomationData = {
  cadence: 'Once on Nov 2 at 18:00',
  last: 'Last run 2 days ago',
  prompt: 'Check that the flaky-test fix held over the weekend and report the pass rate.',
  enabled: false,
  oneTime: true,
};

export const AUTOMATION_PAUSED: AutomationData = {
  cadence: 'Every Friday at 18:00',
  last: 'Last run 6 days ago',
  prompt: 'Sweep the e2e suite for tests that failed twice this week and list them in this thread.',
  enabled: false,
  oneTime: false,
};

export type BadgeVariant = 'chip' | 'status' | 'button';

function badgeLabel(count: number): string {
  return `${count} ${count === 1 ? 'automation' : 'automations'}`;
}

function AutomationBadge({
  variant,
  count,
  muted,
  open,
  onClick,
}: {
  variant: BadgeVariant;
  count: number;
  muted: boolean;
  open: boolean;
  onClick: () => void;
}) {
  const icon = muted ? (
    <Pause aria-hidden="true" strokeWidth={1.75} className="size-3" />
  ) : (
    <Timer aria-hidden="true" strokeWidth={1.75} className="size-3" />
  );
  const common = {
    type: 'button' as const,
    'data-testid': 'automation-badge',
    'aria-label': badgeLabel(count),
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': open,
    onClick,
  };
  if (variant === 'chip') {
    return (
      <button
        {...common}
        className={cn(
          'ml-1 inline-flex h-5 flex-none cursor-pointer items-center gap-1 rounded-full bg-secondary px-1.5 text-caption tabular-nums hover:bg-(--menu-hover) aria-expanded:bg-(--menu-hover)',
          muted ? 'text-content-tertiary' : 'text-content-secondary',
        )}
      >
        {icon}
        <span>{count}</span>
      </button>
    );
  }
  if (variant === 'status') {
    return (
      <>
        <span aria-hidden="true">·</span>
        <button
          {...common}
          className={cn(
            'inline-flex flex-none cursor-pointer items-center gap-1 rounded-(--radius-control) px-1 text-meta tabular-nums hover:bg-(--menu-hover) aria-expanded:bg-(--menu-hover)',
            muted ? 'text-content-tertiary' : 'text-content-secondary',
          )}
        >
          {icon}
          <span>{count}</span>
        </button>
      </>
    );
  }
  return (
    <Button
      {...common}
      variant="ghost"
      size="icon-sm"
      className="relative text-content-tertiary hover:text-foreground aria-expanded:bg-(--menu-hover)"
    >
      {muted ? (
        <Pause aria-hidden="true" strokeWidth={1.75} className="size-4" />
      ) : (
        <Timer aria-hidden="true" strokeWidth={1.75} className="size-4" />
      )}
      <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-caption leading-none text-primary-foreground tabular-nums">
        {count}
      </span>
    </Button>
  );
}

function AutomationPanel({
  data,
  onToggle,
  onDelete,
}: {
  data: AutomationData;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const finished = data.oneTime && data.next == null && data.last != null;
  const timing: string[] = [];
  if (data.enabled && data.next != null) timing.push(data.next);
  else if (finished) timing.push(data.last ?? '', 'No upcoming runs');
  else timing.push('Paused', data.last ?? '');
  return (
    <div
      role="dialog"
      aria-label="Automation"
      data-testid="automation-popover"
      className="flex w-80 flex-col gap-2.5 rounded-(--radius-popover) bg-popover p-3 text-ui text-popover-foreground shadow-(--shadow-popover)"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p data-testid="automation-cadence" className="m-0 font-medium text-foreground">
            {data.cadence}
          </p>
          <p className="m-0 mt-0.5 text-meta text-content-tertiary">
            {timing.filter((part) => part !== '').join(' · ')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Delete automation"
          data-testid="automation-delete"
          onClick={onDelete}
          className="flex-none text-content-tertiary hover:bg-(--danger-soft) hover:text-destructive"
        >
          <Trash2 aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
        </Button>
      </div>
      <p
        data-testid="automation-prompt"
        className="m-0 line-clamp-3 rounded-(--radius-control) bg-secondary px-2.5 py-2 text-meta text-content-secondary"
      >
        {data.prompt}
      </p>
      {!finished && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta text-content-secondary">
            {data.enabled ? 'Enabled' : 'Paused'}
          </span>
          <ToggleSwitch
            aria-label="Enable automation"
            data-testid="automation-enabled"
            checked={data.enabled}
            onCheckedChange={onToggle}
          />
        </div>
      )}
    </div>
  );
}

const PANEL_POSITION: Record<BadgeVariant, string> = {
  chip: 'top-12 left-4',
  status: 'top-16 left-10',
  button: 'top-12 right-3',
};

export function AutomationFrame({
  variant,
  initial,
  initialOpen,
}: {
  variant: BadgeVariant;
  initial: AutomationData;
  initialOpen: boolean;
}) {
  const [data, setData] = useState(initial);
  const [open, setOpen] = useState(initialOpen);
  const [deleted, setDeleted] = useState(false);
  const badge: ReactNode = deleted ? null : (
    <AutomationBadge
      variant={variant}
      count={1}
      muted={!data.enabled}
      open={open}
      onClick={() => setOpen(!open)}
    />
  );
  return (
    <SideChatFrame
      title="Fix the flaky login test"
      tone="working"
      state="Working"
      meta="omarchy · 3m ago"
      heightClass="h-96"
      {...(variant === 'chip' ? { titleExtra: badge } : {})}
      {...(variant === 'status' ? { statusExtra: badge } : {})}
      {...(variant === 'button' ? { headerActions: badge } : {})}
      overlay={
        open && !deleted ? (
          <div className={cn('absolute z-10', PANEL_POSITION[variant])}>
            <AutomationPanel
              data={data}
              onToggle={(enabled) => setData({ ...data, enabled })}
              onDelete={() => setDeleted(true)}
            />
          </div>
        ) : null
      }
      hideComposer
    >
      <FrameTranscript>
        <Transcript transcript={LOGIN_TURN.items.slice(0, 2)} />
      </FrameTranscript>
    </SideChatFrame>
  );
}
