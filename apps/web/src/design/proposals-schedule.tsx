import { cn } from 'cn';
import { AlarmClock, CirclePause, Pencil, Play, TriangleAlert, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ProjectHome } from '../board/project-home.js';
import { ListCard } from '../components/list-card.js';
import { NoticeBanner } from '../components/notice-banner.js';
import { SegmentedRadio } from '../components/segmented.js';
import { ScheduledTaskRow } from '../components/thread/scheduled-task-row.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_BODY_CLS,
  DIALOG_FACE,
  DIALOG_HEAD_CLS,
  DIALOG_SUBTITLE_CLS,
  DIALOG_TITLE_CLS,
  DialogFootRow,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { StatusChip } from '../components/ui/status-chip.js';
import { Switch } from '../components/ui/switch.js';
import type { ScheduleRecord } from '../fixtures/records.js';
import { NOW, PROJECT, TEAM, todo } from './product-fixtures.js';
import { DraftNote, OptionTitle, PhoneFrame, Shot } from './proposals-parts.js';
import { Section, Specimen } from './specimen.js';

type DetailState = 'active' | 'paused' | 'disabled' | 'finished';
type Trigger = 'once' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';

const TRIGGERS: { value: Trigger; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Cron' },
];

const CADENCE: Record<Trigger, string> = {
  once: 'Once, Oct 30 at 09:00',
  hourly: 'Every hour',
  daily: 'Every day at 02:00',
  weekdays: 'Weekdays at 02:00',
  weekly: 'Every Friday at 18:00',
  custom: 'Custom cron',
};

const DISABLED_REASONS = [
  'The task was archived',
  '10 runs in a row without a human message',
  'The host machine was deleted',
];

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

const TITLE = 'Nightly e2e sweep';
const PROMPT =
  'Run the full e2e suite against main. If a spec fails twice in a row, open a thread with the trace attached and tag the owner of the last commit touching it.';

function describeCron(expression: string): { ok: boolean; text: string } {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5)
    return { ok: false, text: 'A cron needs 5 fields: minute hour day month weekday' };
  const [minute = '', hour = '', day = '', month = '', weekday = ''] = parts;
  const every = /^\*\/(\d+)$/.exec(minute);
  const fieldOk = (value: string, max: number) =>
    value === '*' || /^\*\/\d+$/.test(value) || /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(value)
      ? !/^\d+$/.test(value) || Number(value) <= max
      : false;
  if (
    !fieldOk(minute, 59) ||
    !fieldOk(hour, 23) ||
    !fieldOk(day, 31) ||
    !fieldOk(month, 12) ||
    !fieldOk(weekday, 7)
  ) {
    return { ok: false, text: 'One of the fields is out of range or not a number' };
  }
  const days =
    weekday === '1-5'
      ? 'Monday through Friday'
      : weekday === '*'
        ? 'every day'
        : `weekday ${weekday}`;
  if (every != null && hour === '*')
    return { ok: true, text: `Every ${every[1]} minutes, ${days}` };
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    return {
      ok: true,
      text: `At ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}, ${days}`,
    };
  }
  return { ok: true, text: 'Valid expression' };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-content-tertiary">{label}</dt>
      <dd className="m-0 text-ui text-foreground">{children}</dd>
    </div>
  );
}

function PickList({
  value,
  options,
  label,
  onPick,
}: {
  value: string;
  options: string[];
  label: string;
  onPick: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onPick(next as string);
      }}
    >
      <SelectTrigger aria-label={label} className="min-w-16">
        <SelectValue>{value}</SelectValue>
      </SelectTrigger>
      <SelectContent aria-label={label}>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ScheduleDetail({
  state,
  compact = false,
  reason = 0,
  initialTrigger = 'daily',
  initialCron = '0 2 * * 1-5',
}: {
  state: DetailState;
  compact?: boolean;
  reason?: number;
  initialTrigger?: Trigger;
  initialCron?: string;
}) {
  const [trigger, setTrigger] = useState<Trigger>(state === 'finished' ? 'once' : initialTrigger);
  const [cron, setCron] = useState(initialCron);
  const [hour, setHour] = useState('02');
  const [minute, setMinute] = useState('00');
  const [on, setOn] = useState(state === 'active');
  const cronResult = describeCron(cron);
  const finished = state === 'finished';
  const onTheHour = minute === '00' && trigger !== 'custom';
  const lastFailed = state === 'disabled';

  return (
    <div className="flex flex-col gap-4" data-state={state}>
      {state === 'disabled' && (
        <NoticeBanner
          tone="warning"
          icon={TriangleAlert}
          title="Auto-disabled"
          body={DISABLED_REASONS[reason]}
          actions={
            <Button size="sm" variant="outline" onClick={() => setOn(true)}>
              Re-enable
            </Button>
          }
          className="shadow-none ring-1 ring-border"
        />
      )}
      {finished && (
        <NoticeBanner
          tone="info"
          icon={AlarmClock}
          title="One-time schedule finished"
          body="It ran on Oct 30 at 09:00 and will not run again."
          actions={
            <Button size="sm" variant="outline" onClick={() => setTrigger('daily')}>
              Schedule again
            </Button>
          }
          className="shadow-none ring-1 ring-border"
        />
      )}
      <dl className={cn('m-0 grid gap-x-6 gap-y-3', compact ? 'grid-cols-1' : 'grid-cols-2')}>
        <Fact label="Cadence">{CADENCE[trigger]}</Fact>
        <Fact label="Next run">
          {state === 'paused' || state === 'disabled' || finished ? (
            <span className="text-content-tertiary">
              {finished ? 'None, finished' : 'None while off'}
            </span>
          ) : (
            <>
              Sat Nov 1, {hour}:{minute}
              {onTheHour && (
                <span className="mt-0.5 block text-meta text-content-tertiary">
                  Runs on the hour may start a few minutes late.
                </span>
              )}
            </>
          )}
        </Fact>
        <Fact label="Last run">
          <span className="flex flex-wrap items-center gap-2">
            {lastFailed ? (
              <StatusChip tone="failed">Failed</StatusChip>
            ) : (
              <StatusChip tone="done">Succeeded</StatusChip>
            )}
            <span className="text-meta text-content-tertiary">
              {finished ? 'Oct 30, 09:00' : 'Fri Oct 31, 02:00'}
            </span>
          </span>
        </Fact>
        <Fact label="Runs on">omarchy, in cairn</Fact>
      </dl>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-ui font-medium text-foreground">Saved prompt</span>
          <Button variant="ghost" size="xs" className="text-content-secondary">
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
        </div>
        <p className="m-0 line-clamp-4 rounded-md bg-canvas px-3 py-2 text-meta text-content-secondary">
          {PROMPT}
        </p>
      </div>
      {!finished && (
        <div className="flex flex-col gap-2">
          <span className="text-ui font-medium text-foreground">Trigger</span>
          {compact ? (
            <Select
              value={trigger}
              onValueChange={(next) => {
                if (next !== null) setTrigger(next as Trigger);
              }}
            >
              <SelectTrigger aria-label="Trigger" className="w-full">
                <SelectValue>{TRIGGERS.find((item) => item.value === trigger)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent aria-label="Trigger">
                {TRIGGERS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <SegmentedRadio
              label="Trigger"
              value={trigger}
              onChange={setTrigger}
              options={TRIGGERS}
              className="max-w-full [&_button]:px-2"
            />
          )}
          {trigger === 'custom' ? (
            <div className="flex flex-col gap-1.5">
              <Input
                aria-label="Cron expression"
                aria-invalid={!cronResult.ok}
                value={cron}
                onChange={(event) => setCron(event.target.value)}
                className="h-8 rounded-md bg-card font-mono text-code md:text-code"
              />
              <p
                className={cn(
                  'm-0 text-meta',
                  cronResult.ok ? 'text-content-secondary' : 'text-destructive',
                )}
              >
                {cronResult.text}
              </p>
            </div>
          ) : (
            trigger !== 'hourly' && (
              <div className="flex items-center gap-2">
                <PickList value={hour} options={HOURS} label="Hour" onPick={setHour} />
                <span className="text-content-tertiary">:</span>
                <PickList value={minute} options={MINUTES} label="Minute" onPick={setMinute} />
                <span className="text-meta text-content-tertiary">Asia/Shanghai</span>
              </div>
            )
          )}
        </div>
      )}
      <div
        className={cn(
          'flex items-center gap-3 border-t border-border pt-3',
          compact && 'flex-wrap',
        )}
      >
        <Button variant="outline" size="sm">
          <Play data-icon="inline-start" />
          Run now
        </Button>
        <div
          className={cn(
            'flex items-center gap-2 text-ui text-foreground',
            finished && 'text-content-tertiary',
          )}
        >
          <Switch
            aria-label="Active"
            size="sm"
            checked={on}
            onCheckedChange={setOn}
            disabled={finished}
          />
          {on ? 'Active' : 'Paused'}
        </div>
        <Button variant="destructive" size="sm" className="ml-auto">
          Delete
        </Button>
      </div>
    </div>
  );
}

function HeadChip({ state }: { state: DetailState }) {
  if (state === 'active') return <StatusChip tone="done">Active</StatusChip>;
  if (state === 'paused') return <StatusChip tone="idle">Paused</StatusChip>;
  if (state === 'disabled') return <StatusChip tone="failed">Auto-disabled</StatusChip>;
  return <StatusChip tone="idle">Finished</StatusChip>;
}

const STATE_LABEL: Record<DetailState, string> = {
  active: 'Active',
  paused: 'Paused (manual)',
  disabled: 'Auto-disabled',
  finished: 'Finished one-time',
};

function PopoverSurface({
  state,
  compact,
  reason,
  className,
}: {
  state: DetailState;
  compact?: boolean;
  reason?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-(--radius-popover) bg-popover p-3.5 text-popover-foreground shadow-(--shadow-popover)',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <h3 className="m-0 min-w-0 flex-1 truncate text-card-title font-semibold text-foreground">
          {TITLE}
        </h3>
        <HeadChip state={state} />
        <Button variant="ghost" size="icon-xs" aria-label="Close" className="text-content-tertiary">
          <X />
        </Button>
      </div>
      <ScheduleDetail state={state} compact={compact} {...(reason == null ? {} : { reason })} />
    </div>
  );
}

function DialogSurface({
  state,
  reason,
  className,
}: {
  state: DetailState;
  reason?: number;
  className?: string;
}) {
  return (
    <div className={cn('relative flex flex-col overflow-hidden text-ui', DIALOG_FACE, className)}>
      <div className={DIALOG_HEAD_CLS}>
        <div className="min-w-0 flex-1">
          <h3 className={cn('m-0 truncate', DIALOG_TITLE_CLS)}>{TITLE}</h3>
          <div className={DIALOG_SUBTITLE_CLS}>Scheduled task in cairn, #412</div>
        </div>
        <HeadChip state={state} />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close"
          className="absolute top-4 right-4 text-content-tertiary"
        >
          <X />
        </Button>
      </div>
      <div className={DIALOG_BODY_CLS}>
        <ScheduleDetail state={state} {...(reason == null ? {} : { reason })} />
      </div>
      <DialogFootRow hint="Opening the thread is a link inside the dialog">
        <Button variant="ghost" className="text-content-secondary">
          Open thread
        </Button>
        <Button>Save</Button>
      </DialogFootRow>
    </div>
  );
}

const SCHEDULES: ScheduleRecord[] = [
  {
    id: 's1',
    teamId: TEAM,
    projectId: PROJECT,
    todoId: 't1',
    kind: 'daily',
    at: NOW - 3 * 86_400_000,
    tz: 'Asia/Shanghai',
    nextRunAt: NOW + 12 * 3_600_000,
    createdBy: 'ian',
    todo: { seqNum: 412, title: TITLE, phase: 'done', projectName: 'cairn', ownerId: 'ian' },
  },
  {
    id: 's2',
    teamId: TEAM,
    projectId: PROJECT,
    todoId: 't2',
    kind: 'weekly',
    at: NOW - 9 * 86_400_000,
    tz: 'Asia/Shanghai',
    nextRunAt: NOW + 5 * 86_400_000,
    createdBy: 'ian',
    enabled: false,
    pausedReason: 'Paused',
    todo: {
      seqNum: 398,
      title: 'Dependency bump',
      phase: 'done',
      projectName: 'cairn',
      ownerId: 'ian',
    },
  },
  {
    id: 's3',
    teamId: TEAM,
    projectId: PROJECT,
    todoId: 't3',
    kind: 'hourly',
    at: NOW - 20 * 86_400_000,
    tz: 'Asia/Shanghai',
    nextRunAt: NOW + 3_600_000,
    createdBy: 'ian',
    enabled: false,
    pausedReason: 'Auto-disabled: 10 runs without a human message',
    todo: {
      seqNum: 377,
      title: 'Flip detector',
      phase: 'failed',
      projectName: 'cairn',
      ownerId: 'ian',
    },
  },
];

const HOME_TODOS = [
  todo({ title: 'Snooze until needed', phase: 'confirm' }),
  todo({ title: 'Fold finished turns', phase: 'review' }),
  todo({ title: 'Trim the gallery frame', phase: 'building' }),
  todo({ title: 'Per-project memory', phase: 'todo' }),
];

function HomeBackdrop({ children }: { children?: ReactNode }) {
  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-(--radius-card) bg-background ring-1 ring-border"
      style={{ height: 880 }}
    >
      <ProjectHome
        project={{
          id: PROJECT,
          name: 'cairn',
          description: 'The agent team workbench.',
          instructions: 'Keep pull requests small. Run the related tests before pushing.',
          repo: 'xiechimon/cairn',
          baseBranch: 'main',
        }}
        todos={HOME_TODOS}
        schedules={SCHEDULES}
        now={NOW}
        chatHref="/app"
      />
      {children}
    </div>
  );
}

function ScheduleRows() {
  return (
    <>
      <ScheduledTaskRow
        name={TITLE}
        trigger="Daily at 02:00"
        next="Sat Nov 1, 02:00"
        state="active"
        onOpen={() => undefined}
      />
      <ScheduledTaskRow
        name="Dependency bump"
        trigger="Weekly · Mon 09:00"
        state="paused"
        onOpen={() => undefined}
      />
      <ScheduledTaskRow
        name="Flip detector"
        trigger="Auto-disabled: 10 runs without a human message"
        state="disabled"
        onOpen={() => undefined}
      />
    </>
  );
}

const STATES: DetailState[] = ['active', 'paused', 'disabled', 'finished'];

const ROW_STATE: Record<DetailState, 'active' | 'paused' | 'disabled'> = {
  active: 'active',
  paused: 'paused',
  disabled: 'disabled',
  finished: 'paused',
};

const ROW_TRIGGER: Record<DetailState, string> = {
  active: 'Daily at 02:00',
  paused: 'Daily at 02:00',
  disabled: 'Auto-disabled',
  finished: 'Once, Oct 30 at 09:00',
};

function InlineCard({ state, reason }: { state: DetailState; reason?: number }) {
  return (
    <ListCard className="w-full max-w-96">
      <div className="px-1.5 pb-1.5">
        <ScheduledTaskRow
          name={TITLE}
          trigger={ROW_TRIGGER[state]}
          state={ROW_STATE[state]}
          onOpen={() => undefined}
        />
      </div>
      <div className="flex flex-col gap-3 bg-canvas/50 px-3.5 py-3.5">
        <div className="flex items-center gap-2">
          <CirclePause aria-hidden className="size-3.5 text-content-tertiary" />
          <h3 className="m-0 min-w-0 flex-1 truncate text-ui font-semibold text-foreground">
            {TITLE}
          </h3>
          <HeadChip state={state} />
        </div>
        <ScheduleDetail state={state} compact {...(reason == null ? {} : { reason })} />
      </div>
    </ListCard>
  );
}

export function ProposalScheduleSection() {
  return (
    <Section
      id="draft-schedule"
      title="#2324 Schedule detail"
      lede="Opened from a row in the project home's scheduled tasks card, which today opens the thread. The body is one component with four states; the options only change the surface around it."
    >
      <Specimen
        title="A. Popover from the row"
        note="Anchored beside the card; becomes a bottom sheet on a phone"
        stage="canvas"
        className="flex-col flex-nowrap"
      >
        <Shot id="schedule-a-context">
          <OptionTitle option="A" title="Popover, in context (active)" />
          <div className="relative">
            <HomeBackdrop />
            <PopoverSurface
              state="active"
              className="absolute top-96 right-88 w-112 max-w-[calc(100%-1rem)]"
            />
          </div>
        </Shot>
        <Shot id="schedule-a-states" className="grid grid-cols-2 items-start gap-5">
          {STATES.map((state) => (
            <div key={state} className="flex w-full flex-col gap-2">
              <span className="text-caption text-content-tertiary">{STATE_LABEL[state]}</span>
              <PopoverSurface state={state} />
            </div>
          ))}
        </Shot>
        <Shot id="schedule-a-phone" className="items-start">
          <OptionTitle option="A" title="Phone: bottom sheet" />
          <PhoneFrame>
            <div className="h-36 flex-none overflow-hidden bg-(--dialog-backdrop) p-3 pt-6">
              <ListCard className="opacity-70">
                <ScheduleRows />
              </ListCard>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-t-(--edge-radius) bg-popover p-4 shadow-(--shadow-popover)">
              <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" />
              <div className="mb-3 flex items-center gap-2">
                <h3 className="m-0 min-w-0 flex-1 truncate text-card-title font-semibold text-foreground">
                  {TITLE}
                </h3>
                <HeadChip state="active" />
              </div>
              <ScheduleDetail state="active" compact />
            </div>
          </PhoneFrame>
        </Shot>
      </Specimen>
      <Specimen
        title="B. Dialog"
        note="Same body in the app dialog shell; the footer carries Save and a link to the thread"
        stage="canvas"
        className="flex-col flex-nowrap"
      >
        <Shot id="schedule-b-context">
          <OptionTitle option="B" title="Dialog, in context (active)" />
          <div className="relative">
            <HomeBackdrop>
              <div className="absolute inset-0 flex items-center justify-center bg-(--dialog-backdrop)">
                <DialogSurface state="active" className="w-120 max-w-[calc(100%-2rem)]" />
              </div>
            </HomeBackdrop>
          </div>
        </Shot>
        <Shot id="schedule-b-states" className="grid grid-cols-2 items-start gap-5">
          {STATES.map((state) => (
            <div key={state} className="flex w-full flex-col gap-2">
              <span className="text-caption text-content-tertiary">{STATE_LABEL[state]}</span>
              <DialogSurface state={state} reason={state === 'disabled' ? 1 : undefined} />
            </div>
          ))}
        </Shot>
        <Shot id="schedule-b-phone" className="items-start">
          <OptionTitle option="B" title="Phone: full-height dialog" />
          <PhoneFrame>
            <div className="flex min-h-0 flex-1 flex-col bg-dialog-surface">
              <div className={DIALOG_HEAD_CLS}>
                <div className="min-w-0 flex-1">
                  <h3 className={cn('m-0 truncate', DIALOG_TITLE_CLS)}>{TITLE}</h3>
                  <div className={DIALOG_SUBTITLE_CLS}>Scheduled task in cairn, #412</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Close"
                  className="text-content-tertiary"
                >
                  <X />
                </Button>
              </div>
              <div className={cn('flex-1', DIALOG_BODY_CLS)}>
                <ScheduleDetail state="paused" compact />
              </div>
              <DialogFootRow>
                <Button>Save</Button>
              </DialogFootRow>
            </div>
          </PhoneFrame>
        </Shot>
      </Specimen>
      <Specimen
        title="C. Inline expand in the card"
        note="The row grows in place; the card stays 20rem wide"
        stage="canvas"
      >
        <Shot id="schedule-c" className="w-full flex-row flex-wrap items-start gap-5">
          {STATES.map((state) => (
            <div key={state} className="flex w-96 max-w-full flex-col gap-2">
              <span className="text-caption text-content-tertiary">{STATE_LABEL[state]}</span>
              <InlineCard state={state} reason={state === 'disabled' ? 2 : undefined} />
            </div>
          ))}
        </Shot>
      </Specimen>
      <DraftNote>
        Cron validation is live in the Custom cron trigger of any card: clear a field to see the
        error. Heads-up copy under Next run shows only when the minute is 00.
      </DraftNote>
    </Section>
  );
}
