import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ChiefStreamRow } from '../chief/chief-message-rows.js';
import { LivePulse } from '../components/chat/live-row.js';
import { StatusGlyph } from '../components/status-glyph.js';
import { MessageScrollerProvider } from '../components/ui/message-scroller.js';
import { Transcript } from '../detail/transcript.js';
import type { ChiefStreamItem, TranscriptItem, WorkStep } from '../fixtures/records.js';
import { FrameTranscript } from './proposals-frame.js';

export type TurnVariant = 'row' | 'chip' | 'card';
export type TurnStatus = 'done' | 'failed' | 'live';

export interface TurnData<TItem> {
  id: string;
  purpose: string;
  duration: string;
  status: TurnStatus;
  items: TItem[];
}

const call = (
  id: string,
  action: 'read' | 'search' | 'run' | 'edit',
  label: string,
  detail: string,
  seconds: number | null,
  extra: Partial<Extract<WorkStep, { kind: 'call' }>> = {},
): WorkStep => ({
  kind: 'call',
  id,
  action,
  label,
  ...(action === 'run' ? { command: detail } : { target: detail }),
  output: null,
  error: false,
  running: false,
  unfinished: false,
  seconds,
  ...extra,
});

export const LOGIN_TURN: TurnData<TranscriptItem> = {
  id: 'login',
  purpose: 'Fixed the flaky login test',
  duration: '4 minutes',
  status: 'done',
  items: [
    {
      kind: 'user',
      id: 'u1',
      text: 'The login e2e fails on CI about one run in five. Can you fix it?',
    },
    {
      kind: 'work',
      id: 'w1',
      steps: [
        call('a1', 'read', 'Read', 'e2e/login.spec.ts L1-80', 1),
        call('a2', 'search', 'Search', 'waitForURL', 1, { output: '3 matches in 2 files' }),
        call('a3', 'edit', 'Edit', 'e2e/login.spec.ts', 2, {
          diff: { added: 4, removed: 1 },
          changes: {
            removed: ["await page.click('text=Sign in');"],
            added: ["await page.click('text=Sign in');", "await page.waitForURL('**/inbox');"],
          },
        }),
        call('a4', 'run', 'Run', 'pnpm exec playwright test login --repeat-each=20', 61, {
          output: '20 passed',
        }),
      ],
    },
    {
      kind: 'robot',
      id: 'r1',
      paragraphs: [
        [
          {
            text: 'The test clicked Sign in and read the cookie before the redirect finished. It now waits for the inbox URL first; 20 repeated runs pass.',
          },
        ],
      ],
      footer: { seconds: 240 },
    },
  ],
};

export const AUTH_TURN: TurnData<TranscriptItem> = {
  id: 'auth',
  purpose: 'Ran the auth suite on omarchy',
  duration: '2 minutes',
  status: 'done',
  items: [
    { kind: 'user', id: 'u2', text: 'Run the whole auth suite too.' },
    {
      kind: 'work',
      id: 'w2',
      steps: [
        call('b1', 'run', 'Run', 'pnpm exec playwright test auth', 96, { output: '38 passed' }),
      ],
    },
    {
      kind: 'robot',
      id: 'r2',
      paragraphs: [[{ text: 'All 38 auth tests pass.' }]],
      footer: { seconds: 120 },
    },
  ],
};

export const LIVE_TURN: TurnData<TranscriptItem> = {
  id: 'live',
  purpose: 'Adding a regression test',
  duration: '0:42',
  status: 'live',
  items: [
    { kind: 'user', id: 'u3', text: 'Add a regression test for the redirect race.' },
    {
      kind: 'work',
      id: 'w3',
      steps: [
        call('c1', 'read', 'Read', 'e2e/helpers/session.ts L1-60', 1),
        call('c2', 'run', 'Run', 'pnpm exec playwright test login --grep redirect', null, {
          running: true,
        }),
      ],
    },
  ],
};

export const FAILED_TURN: TurnData<TranscriptItem> = {
  id: 'failed',
  purpose: 'Tried to bump the Playwright version',
  duration: 'failed after 2 minutes',
  status: 'failed',
  items: [
    { kind: 'user', id: 'u4', text: 'Bump Playwright to the latest release.' },
    {
      kind: 'work',
      id: 'w4',
      steps: [
        call('d1', 'run', 'Run', 'pnpm up @playwright/test', 14, {
          error: true,
          output: 'ERR_PNPM_PEER_DEP_ISSUES  Unmet peer dependencies',
        }),
      ],
    },
    {
      kind: 'fail',
      title: 'The run stopped',
      body: 'pnpm could not resolve the peer dependencies for @playwright/test.',
    },
  ],
};

export const CHIEF_TURNS: TurnData<ChiefStreamItem>[] = [
  {
    id: 'chief-1',
    purpose: 'Opened #2235 and #2241 for the thread polish',
    duration: '3 minutes',
    status: 'done',
    items: [
      {
        kind: 'user',
        id: 'cu1',
        text: 'File the turn folding and automation badge work as threads.',
      },
      {
        kind: 'robot',
        id: 'cr1',
        seconds: '3m',
        tools: [
          { label: 'Created thread #2235', seconds: 2 },
          { label: 'Created thread #2241', seconds: 2 },
        ],
        paragraphs: [
          [
            { text: 'Opened ' },
            { text: '#2235', todo: 2235 },
            { text: ' and ' },
            { text: '#2241', todo: 2241 },
            { text: ' on cairn. Both are queued for the next free machine.' },
          ],
        ],
      },
    ],
  },
  {
    id: 'chief-2',
    purpose: 'Summarised what is waiting on you',
    duration: '1 minute',
    status: 'done',
    items: [
      { kind: 'user', id: 'cu2', text: 'What is waiting on me?' },
      {
        kind: 'robot',
        id: 'cr2',
        seconds: '1m',
        paragraphs: [[{ text: 'Two plans to approve and one failed build on cairn.' }]],
      },
    ],
  },
  {
    id: 'chief-3',
    purpose: 'Tried to start #2250',
    duration: 'failed after 30 seconds',
    status: 'failed',
    items: [
      { kind: 'user', id: 'cu3', text: 'Start #2250 on omarchy.' },
      { kind: 'error', text: 'omarchy went offline before the run was dispatched.' },
    ],
  },
];

function TurnGlyph({ status }: { status: TurnStatus }) {
  if (status === 'live') return <LivePulse />;
  return (
    <StatusGlyph
      kind={status === 'failed' ? 'failed' : 'done'}
      className={cn(
        'size-3.5 flex-none',
        status === 'failed' ? 'text-destructive' : 'text-content-dim',
      )}
    />
  );
}

function Header({
  variant,
  turn,
  open,
  onToggle,
}: {
  variant: TurnVariant;
  turn: TurnData<unknown>;
  open: boolean;
  onToggle: () => void;
}) {
  const live = turn.status === 'live';
  const failed = turn.status === 'failed';

  if (variant === 'row') {
    const content = (
      <>
        {live ? (
          <span className="flex size-3.5 flex-none items-center justify-center">
            <LivePulse />
          </span>
        ) : (
          <ChevronRight
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn(
              'size-3.5 flex-none text-content-dim transition-transform duration-(--dur-fast)',
              open && 'rotate-90',
            )}
          />
        )}
        <span
          className={cn(
            'min-w-0 truncate font-medium',
            failed ? 'text-destructive' : 'text-content-secondary',
          )}
        >
          {turn.purpose}
        </span>
        <span className="flex-none text-content-tertiary">· {turn.duration}</span>
      </>
    );
    const cls =
      '-mx-2 flex w-[calc(100%+1rem)] items-center gap-1.5 rounded-(--radius-control) px-2 py-1 text-left text-meta';
    return live ? (
      <div data-testid="turn-header" data-state="live" className={cls}>
        {content}
      </div>
    ) : (
      <button
        type="button"
        data-testid="turn-header"
        data-state={turn.status}
        aria-expanded={open}
        onClick={onToggle}
        className={cn(cls, 'cursor-pointer hover:bg-(--menu-hover)')}
      >
        {content}
      </button>
    );
  }

  if (variant === 'chip') {
    const chipCls = cn(
      'inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2.5 text-caption inset-ring-1',
      failed
        ? 'bg-(--danger-soft) text-destructive inset-ring-destructive/40'
        : 'bg-card text-content-secondary inset-ring-border',
    );
    const content = (
      <>
        {live ? <LivePulse /> : <TurnGlyph status={turn.status} />}
        <span className="min-w-0 truncate">
          {turn.purpose}{' '}
          <span className={failed ? '' : 'text-content-tertiary'}>· {turn.duration}</span>
        </span>
        {!live && (
          <ChevronRight
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn(
              'size-3 flex-none transition-transform duration-(--dur-fast)',
              open && 'rotate-90',
            )}
          />
        )}
      </>
    );
    const rule =
      'flex items-center gap-3 before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border';
    return (
      <div className={rule}>
        {live ? (
          <div data-testid="turn-header" data-state="live" className={chipCls}>
            {content}
          </div>
        ) : (
          <button
            type="button"
            data-testid="turn-header"
            data-state={turn.status}
            aria-expanded={open}
            onClick={onToggle}
            className={cn(chipCls, 'cursor-pointer hover:bg-(--menu-hover)')}
          >
            {content}
          </button>
        )}
      </div>
    );
  }

  const content = (
    <>
      <TurnGlyph status={turn.status} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-left text-ui font-medium',
          failed ? 'text-destructive' : 'text-foreground',
        )}
      >
        {turn.purpose}
        <span className="sr-only"> · {turn.duration}</span>
      </span>
      <span aria-hidden="true" className="flex-none text-meta text-content-tertiary tabular-nums">
        {turn.duration}
      </span>
      {!live && (
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'size-3.5 flex-none text-content-dim transition-transform duration-(--dur-fast)',
            open && 'rotate-90',
          )}
        />
      )}
    </>
  );
  const cardCls = 'flex min-h-9 w-full items-center gap-2 px-3 py-1.5';
  return live ? (
    <div data-testid="turn-header" data-state="live" className={cardCls}>
      {content}
    </div>
  ) : (
    <button
      type="button"
      data-testid="turn-header"
      data-state={turn.status}
      aria-expanded={open}
      onClick={onToggle}
      className={cn(cardCls, 'cursor-pointer rounded-(--radius-card) hover:bg-(--menu-hover)')}
    >
      {content}
    </button>
  );
}

function TurnFold<TItem>({
  variant,
  turn,
  open,
  onToggle,
  children,
}: {
  variant: TurnVariant;
  turn: TurnData<TItem>;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const shown = open || turn.status === 'live';
  const header = <Header variant={variant} turn={turn} open={shown} onToggle={onToggle} />;
  if (variant === 'card') {
    return (
      <section
        data-testid="turn"
        className="mt-3 rounded-(--radius-card) bg-card shadow-(--e1) first:mt-0"
      >
        {header}
        {shown && <div className="border-t border-border px-3 pb-3">{children}</div>}
      </section>
    );
  }
  return (
    <section data-testid="turn" className={cn(variant === 'chip' ? 'mt-4' : 'mt-2', 'first:mt-0')}>
      {header}
      {shown && <div className={variant === 'row' ? 'pb-1' : ''}>{children}</div>}
    </section>
  );
}

function useOpenSet(initial: readonly string[]) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initial));
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { open, toggle };
}

function withoutDuration(item: TranscriptItem): TranscriptItem {
  return item.kind === 'robot' ? { ...item, footer: {} } : item;
}

export function TurnThread({
  variant,
  turns,
  initialOpen,
}: {
  variant: TurnVariant;
  turns: readonly TurnData<TranscriptItem>[];
  initialOpen: readonly string[];
}) {
  const { open, toggle } = useOpenSet(initialOpen);
  return (
    <FrameTranscript>
      {turns.map((turn) => (
        <TurnFold
          key={turn.id}
          variant={variant}
          turn={turn}
          open={open.has(turn.id)}
          onToggle={() => toggle(turn.id)}
        >
          <Transcript
            transcript={variant === 'card' ? turn.items.map(withoutDuration) : turn.items}
          />
        </TurnFold>
      ))}
    </FrameTranscript>
  );
}

const noop = () => undefined;

export function ChiefTurnThread({
  variant,
  turns,
  initialOpen,
}: {
  variant: TurnVariant;
  turns: readonly TurnData<ChiefStreamItem>[];
  initialOpen: readonly string[];
}) {
  const { open, toggle } = useOpenSet(initialOpen);
  const [toolsOpen] = useState<ReadonlySet<number>>(() => new Set());
  return (
    <MessageScrollerProvider autoScroll={false} defaultScrollPosition="start">
      <div className="chat-col px-6 py-4">
        <div className="mx-auto w-full max-w-(--chat-max-w)">
          {turns.map((turn, turnIndex) => (
            <TurnFold
              key={turn.id}
              variant={variant}
              turn={turn}
              open={open.has(turn.id)}
              onToggle={() => toggle(turn.id)}
            >
              {turn.items.map((item, index) => (
                <ChiefStreamRow
                  key={'id' in item && item.id != null ? item.id : index}
                  item={item}
                  index={turnIndex * 10 + index}
                  latest={false}
                  bound={false}
                  agent={undefined}
                  runningTool={undefined}
                  copiedKey={null}
                  onCopy={noop}
                  toolsOpen={toolsOpen}
                  onToggleTools={noop}
                  onRewindRequest={noop}
                />
              ))}
            </TurnFold>
          ))}
        </div>
      </div>
    </MessageScrollerProvider>
  );
}
