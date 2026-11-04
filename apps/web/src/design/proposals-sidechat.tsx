import { cn } from 'cn';
import {
  Check,
  ChevronRight,
  Clock,
  FileDiff,
  GitCommitHorizontal,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ThreadActionCard } from '../board/thread-actions.js';
import {
  CAPSULE_CLS,
  CAPSULE_ICON_BTN,
  CAPSULE_QUEUED_CLS,
} from '../components/queued-capsules.js';
import { SegmentedTabs } from '../components/segmented.js';
import { StatStrip } from '../components/stat-strip.js';
import { NextSteps } from '../components/thread/next-steps.js';
import { UsageStrip } from '../components/thread/usage-strip.js';
import { Button } from '../components/ui/button.js';
import { Composer } from '../detail/composer.js';
import { DocPane } from '../detail/docpane.js';
import { Transcript } from '../detail/transcript.js';
import { ArrowUp } from '../icons/index.js';
import { CHANGES, NOW } from './product-fixtures.js';
import { FrameTranscript, SideChatFrame } from './proposals-frame.js';
import { LOGIN_TURN } from './proposals-turns.js';

const USAGE = {
  cost: '$1.42',
  tokens: '212k',
  cached: '91%',
  duration: '6m 02s',
  model: 'Opus 5.5',
  machine: 'omarchy',
};

const COMMITS = [
  {
    sha: 'a3f91c2',
    subject: 'e2e(login): wait for the inbox URL before reading the cookie',
    age: '4m ago',
  },
  { sha: '7be04d1', subject: 'e2e(login): add a repeat-each smoke run', age: '9m ago' },
  {
    sha: '1c88e5a',
    subject: 'web(login): keep the session cookie after the redirect',
    age: '12m ago',
  },
];

function ThreadTranscript({ withCommits = false }: { withCommits?: boolean }) {
  return (
    <FrameTranscript>
      <Transcript transcript={LOGIN_TURN.items} />
      {withCommits && <CommitsCard />}
    </FrameTranscript>
  );
}

export function UsageUnderStatus() {
  return (
    <SideChatFrame
      tone="review"
      state="Awaiting review"
      belowHeader={
        <StatStrip
          className="mx-4 mt-3 flex-none grid-cols-2"
          items={[
            { value: USAGE.cost, label: 'cost' },
            { value: USAGE.tokens, label: `tokens · ${USAGE.cached} cached` },
            { value: USAGE.duration, label: 'time' },
            { value: USAGE.model, label: USAGE.machine },
          ]}
        />
      }
    >
      <ThreadTranscript />
    </SideChatFrame>
  );
}

export function UsageFooter({ initialOpen }: { initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <SideChatFrame
      tone="review"
      state="Awaiting review"
      aboveComposer={
        <div className="mx-4 mb-2 flex flex-none flex-col gap-2">
          {open && <UsageStrip {...USAGE} />}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-(--radius-control) px-1 py-1 text-left text-meta text-content-tertiary hover:bg-(--menu-hover)"
          >
            <ChevronRight
              aria-hidden="true"
              strokeWidth={1.75}
              className={cn('size-3.5 flex-none text-content-dim', open && '-rotate-90')}
            />
            <span className="min-w-0 truncate tabular-nums">
              {USAGE.cost} · {USAGE.tokens} tokens · {USAGE.duration} · {USAGE.model}
            </span>
          </button>
        </div>
      }
    >
      <ThreadTranscript />
    </SideChatFrame>
  );
}

function ExpandButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  const Icon = expanded ? Minimize2 : Maximize2;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={expanded ? 'Collapse to side panel' : 'Expand to full width'}
      aria-pressed={expanded}
      data-testid="side-chat-expand"
      onClick={onClick}
      className="text-content-tertiary hover:text-foreground"
    >
      <Icon aria-hidden="true" strokeWidth={1.75} className="size-4" />
    </Button>
  );
}

export function ExpandCentered({ initialExpanded }: { initialExpanded: boolean }) {
  const [expanded, setExpanded] = useState(initialExpanded);
  return (
    <SideChatFrame
      wide={expanded}
      heightClass="h-150"
      headerActions={<ExpandButton expanded={expanded} onClick={() => setExpanded(!expanded)} />}
    >
      <ThreadTranscript />
    </SideChatFrame>
  );
}

function Rail() {
  return (
    <aside
      data-testid="side-chat-rail"
      className="flex w-64 flex-none flex-col gap-4 overflow-hidden border-l border-border p-4"
    >
      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-caption font-medium text-content-tertiary">Usage</h3>
        <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border shadow-(--e1)">
          {[
            [USAGE.cost, 'cost'],
            [USAGE.tokens, `${USAGE.cached} cached`],
            [USAGE.duration, 'time'],
            [USAGE.model, USAGE.machine],
          ].map(([value, label]) => (
            <div key={label} className="min-w-0 bg-card px-3 py-2">
              <dd className="m-0 truncate text-ui font-medium text-foreground tabular-nums">
                {value}
              </dd>
              <dt className="truncate text-caption text-content-tertiary">{label}</dt>
            </div>
          ))}
        </dl>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-caption font-medium text-content-tertiary">Changes</h3>
        <p className="m-0 flex items-center gap-2 text-meta text-content-secondary">
          <FileDiff aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-icon" />1 file
          <span className="text-running-text tabular-nums">+2</span>
          <span className="text-destructive tabular-nums">−1</span>
        </p>
      </section>
      <section className="flex min-h-0 flex-col gap-2">
        <h3 className="m-0 text-caption font-medium text-content-tertiary">Commits</h3>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {COMMITS.map((commit) => (
            <li key={commit.sha} className="flex min-w-0 items-baseline gap-2 text-meta">
              <code className="flex-none font-mono text-code text-content-secondary">
                {commit.sha}
              </code>
              <span className="truncate text-content-tertiary">{commit.subject}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

export function ExpandSplit({ initialExpanded }: { initialExpanded: boolean }) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const toggle = <ExpandButton expanded={expanded} onClick={() => setExpanded(!expanded)} />;
  if (!expanded) {
    return (
      <SideChatFrame headerActions={toggle}>
        <ThreadTranscript />
      </SideChatFrame>
    );
  }
  return (
    <SideChatFrame wide heightClass="h-150" headerActions={toggle} hideComposer>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <ThreadTranscript />
          <Composer placeholder="Reply to #2323…" aiReview={false} streaming={false} editable />
        </div>
        <Rail />
      </div>
    </SideChatFrame>
  );
}

function ChangesBody() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <DocPane
        mode="changes"
        doc={undefined}
        changes={CHANGES}
        now={NOW}
        onDocView={() => undefined}
      />
    </div>
  );
}

type ThreadView = 'chat' | 'changes';

export function ChangesTabs({ initial }: { initial: ThreadView }) {
  const [view, setView] = useState<ThreadView>(initial);
  return (
    <SideChatFrame
      tone="review"
      state="Awaiting review"
      belowHeader={
        <div className="flex-none px-4 pt-2.5">
          <SegmentedTabs
            label="Thread view"
            value={view}
            onChange={setView}
            className="w-full"
            options={[
              { value: 'chat', label: 'Conversation' },
              { value: 'changes', label: 'Changes · 1' },
            ]}
          />
        </div>
      }
    >
      {view === 'chat' ? <ThreadTranscript /> : <ChangesBody />}
    </SideChatFrame>
  );
}

export function ChangesHeaderButton({ initial }: { initial: ThreadView }) {
  const [view, setView] = useState<ThreadView>(initial);
  const active = view === 'changes';
  return (
    <SideChatFrame
      tone="review"
      state="Awaiting review"
      headerActions={
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={active}
          aria-label={active ? 'Back to conversation' : 'Show changes'}
          data-testid="side-chat-changes"
          onClick={() => setView(active ? 'chat' : 'changes')}
          className={cn(
            'h-7 gap-1 px-1.5 text-meta text-content-secondary',
            active && 'bg-(--menu-hover) text-foreground',
          )}
        >
          <FileDiff aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          <span className="text-running-text tabular-nums">+2</span>
          <span className="text-destructive tabular-nums">−1</span>
        </Button>
      }
    >
      {active ? <ChangesBody /> : <ThreadTranscript />}
    </SideChatFrame>
  );
}

interface Chip {
  id: string;
  content: string;
}

function EditableCapsules({
  initial,
  initialEditing,
}: {
  initial: Chip[];
  initialEditing: string | null;
}) {
  const [chips, setChips] = useState(initial);
  const [editing, setEditing] = useState(initialEditing);
  const [draft, setDraft] = useState(
    () => initial.find((chip) => chip.id === initialEditing)?.content ?? '',
  );
  const startEdit = (chip: Chip) => {
    setDraft(chip.content);
    setEditing(chip.id);
  };
  const save = (id: string) => {
    const content = draft.trim();
    if (content !== '')
      setChips(chips.map((chip) => (chip.id === id ? { ...chip, content } : chip)));
    setEditing(null);
  };
  return (
    <ul
      data-testid="queued-capsules"
      aria-label="Queued messages"
      className="mx-4 flex flex-none list-none flex-col items-start gap-1.5 p-0 pb-2.5"
    >
      {chips.map((chip) =>
        editing === chip.id ? (
          <li
            key={chip.id}
            data-testid="queued-message"
            data-state="editing"
            className="flex w-full flex-col gap-1"
          >
            <div className={cn(CAPSULE_CLS, 'w-full bg-card inset-ring-(--focus-ring)')}>
              <Clock width={14} height={14} className="flex-none text-content-tertiary" />
              <input
                ref={(node) => node?.focus({ preventScroll: true })}
                aria-label="Edit queued message"
                data-testid="queued-message-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') save(chip.id);
                  if (event.key === 'Escape') setEditing(null);
                }}
                className="min-w-0 flex-1 bg-transparent text-meta text-foreground outline-none"
              />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Save"
                className={CAPSULE_ICON_BTN}
                onClick={() => save(chip.id)}
              >
                <Check width={12} height={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Cancel edit"
                className={CAPSULE_ICON_BTN}
                onClick={() => setEditing(null)}
              >
                <X width={12} height={12} />
              </Button>
            </div>
            <span className="pl-3 text-caption text-content-tertiary">
              Enter to save · Esc to cancel
            </span>
          </li>
        ) : (
          <li
            key={chip.id}
            data-testid="queued-message"
            data-state="queued"
            className={cn(CAPSULE_CLS, CAPSULE_QUEUED_CLS)}
          >
            <Clock width={14} height={14} className="flex-none text-content-tertiary" />
            <button
              type="button"
              title="Click to edit"
              data-testid="queued-message-text"
              onClick={() => startEdit(chip)}
              className="min-w-0 cursor-text truncate text-left"
            >
              {chip.content}
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Send now"
              className={CAPSULE_ICON_BTN}
            >
              <ArrowUp width={12} height={12} />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Remove" className={CAPSULE_ICON_BTN}>
              <X width={12} height={12} />
            </Button>
          </li>
        ),
      )}
    </ul>
  );
}

const QUEUED: Chip[] = [
  { id: 'q1', content: 'Also run the auth suite once the login test is green' },
  { id: 'q2', content: 'Then open a PR against main' },
];

export function QueuedFrame({ initialEditing }: { initialEditing: string | null }) {
  return (
    <SideChatFrame
      streaming
      aboveComposer={<EditableCapsules initial={QUEUED} initialEditing={initialEditing} />}
    >
      <ThreadTranscript />
    </SideChatFrame>
  );
}

function CommitsCard() {
  return (
    <section
      data-testid="thread-commits"
      aria-label="Commits"
      className="mt-4 overflow-hidden rounded-(--radius-card) bg-card shadow-(--e1)"
    >
      <h3 className="m-0 flex items-center gap-1.5 border-b border-border px-3 py-2 text-meta font-medium text-content-secondary">
        <GitCommitHorizontal aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-icon" />
        Commits
        <span className="font-normal text-content-tertiary tabular-nums">{COMMITS.length}</span>
      </h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {COMMITS.map((commit) => (
          <li key={commit.sha} className="not-last:border-b not-last:border-border">
            <a
              href={`#${commit.sha}`}
              className="flex items-baseline gap-2 px-3 py-2 text-meta no-underline hover:bg-(--menu-hover)"
            >
              <code className="flex-none font-mono text-code text-foreground">{commit.sha}</code>
              <span className="min-w-0 flex-1 truncate text-content-secondary">
                {commit.subject}
              </span>
              <span className="flex-none text-caption text-content-tertiary">{commit.age}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="m-0 border-t border-border px-3 py-2 text-caption text-content-tertiary">
        Each commit message ends with <code className="font-mono text-code">Thread: #2323</code>,
        which links back here.
      </p>
    </section>
  );
}

export function CommitsFrame() {
  return (
    <SideChatFrame tone="review" state="Awaiting review" heightClass="h-240">
      <ThreadTranscript withCommits />
    </SideChatFrame>
  );
}

const STEPS = [
  { label: 'Run the auth suite' },
  { label: 'Open a PR' },
  { label: 'Summarise the change' },
];

function noop() {
  return undefined;
}

export type NextStepsLayout = 'stacked' | 'merged';
export type PhaseKind = 'approve' | 'finish' | null;

function PhaseCard({ kind, children }: { kind: 'approve' | 'finish'; children?: ReactNode }) {
  return (
    <ThreadActionCard
      kind={kind}
      busy={false}
      orchestrating={false}
      onPrimary={noop}
      onViewPlan={kind === 'approve' ? noop : undefined}
    >
      {children}
    </ThreadActionCard>
  );
}

export function NextStepsFrame({ layout, kind }: { layout: NextStepsLayout; kind: PhaseKind }) {
  const steps = <NextSteps steps={STEPS} />;
  let above: ReactNode;
  if (layout === 'stacked') {
    above = (
      <>
        <div className="mx-4 mb-2 flex-none">{steps}</div>
        {kind != null && <PhaseCard kind={kind} />}
      </>
    );
  } else if (kind != null) {
    above = (
      <PhaseCard kind={kind}>
        <div className="basis-full border-t border-border pt-2.5">{steps}</div>
      </PhaseCard>
    );
  } else {
    above = <div className="mx-4 mb-2 flex-none">{steps}</div>;
  }
  return (
    <SideChatFrame
      tone={kind === 'approve' ? 'waiting' : kind === 'finish' ? 'review' : 'idle'}
      state={kind === 'approve' ? 'Plan ready' : kind === 'finish' ? 'Awaiting review' : 'Idle'}
      aboveComposer={above}
    >
      <ThreadTranscript />
    </SideChatFrame>
  );
}
