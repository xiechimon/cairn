import { Inbox, Library, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { HeaderIconButton } from '../components/shell/header-icon-button.js';
import { WaitPill } from '../components/shell/wait-pill.js';
import { Pebble } from '../components/stone/pebble.js';
import { StoneGroup, StoneTrail } from '../components/stone/stone-group.js';
import type { StoneKind } from '../components/stone/stone-mark.js';
import { STONE_KINDS, StoneMark } from '../components/stone/stone-mark.js';
import { STONE_TONES, type StoneTone } from '../components/stone/tone.js';
import { BulkBar } from '../components/thread/bulk-bar.js';
import { ThreadCard } from '../components/thread/thread-card.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import { Button } from '../components/ui/button.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { Cell, Section, Specimen } from './specimen.js';

export function StoneSection() {
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<'threads' | 'library' | null>('threads');
  return (
    <Section
      id="stone"
      title="Stone marks and trail"
      lede="Status is a pebble. Five tones carry the whole inbox: waiting (ochre), review (slate), working (lichen), idle and resolved (stone). Marks add a kind icon; the working mark spins unless still, and holds still under reduced motion."
    >
      <Specimen title="Pebble" note="8 by 7, one per tone" code={`<Pebble tone="waiting" />`}>
        {STONE_TONES.map((tone) => (
          <Cell key={tone} label={tone}>
            <Pebble tone={tone} />
          </Cell>
        ))}
      </Specimen>
      <Specimen
        title="Stone mark"
        note="22px pebble with the kind icon, every tone and kind"
        code={`<StoneMark tone="working" kind="running" />\n<StoneMark tone="working" kind="idle" still />`}
      >
        {(
          [
            ['waiting', 'question'],
            ['waiting', 'plan'],
            ['waiting', 'permission'],
            ['review', 'pr'],
            ['working', 'running'],
            ['idle', 'idle'],
            ['idle', 'snoozed'],
            ['resolved', 'done'],
          ] as const satisfies readonly (readonly [StoneTone, StoneKind])[]
        ).map(([tone, kind]) => (
          <Cell key={kind} label={`${tone} / ${kind}`}>
            <StoneMark tone={tone} kind={kind} />
          </Cell>
        ))}
        <Cell label="working, still">
          <StoneMark tone="working" kind="idle" still />
        </Cell>
        <Cell label={`${STONE_KINDS.length} kinds in all`}>
          {STONE_KINDS.map((kind) => (
            <StoneMark key={kind} tone="idle" kind={kind} />
          ))}
        </Cell>
      </Specimen>
      <Specimen
        title="Stone trail"
        note="Group header: pebble, label, count, collapse chevron; the dashed line is the trail"
        stage="canvas"
        code={`<StoneTrail>\n  <StoneGroup tone="waiting" label="Waiting on you" count={2}>{rows}</StoneGroup>\n</StoneTrail>`}
      >
        <div className="w-96 rounded-(--radius-card) bg-background">
          <StoneTrail>
            <StoneGroup
              tone="waiting"
              label="Waiting on you"
              count={0}
              emptyHint="Nothing is waiting on you."
            />
            <StoneGroup
              tone="review"
              label="Ready for review"
              count={0}
              emptyHint="No pull request is waiting."
            />
            <StoneGroup
              tone="working"
              label="Working"
              count={3}
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
            >
              <p className="m-0 px-2.5 py-2 text-ui text-content-secondary">
                Three threads are running.
              </p>
            </StoneGroup>
            <StoneGroup tone="idle" label="Idle" count={2} collapsed />
            <StoneGroup tone="resolved" label="Resolved" count={14} collapsed />
          </StoneTrail>
        </div>
      </Specimen>
      <Specimen
        title="Wait pill and header icon buttons"
        note="The pill sits beside a panel title; the attention dot marks a panel with something waiting"
        code={`<WaitPill count={2} />\n<HeaderIconButton attention active aria-label="Threads"><Inbox /></HeaderIconButton>`}
      >
        <Cell label="wait pill">
          <WaitPill count={3} />
        </Cell>
        <Cell label="default, active, attention">
          <HeaderIconButton
            aria-label="Library"
            onClick={() => setPanel('library')}
            active={panel === 'library'}
          >
            <Library />
          </HeaderIconButton>
          <HeaderIconButton
            aria-label="Threads"
            attention
            onClick={() => setPanel('threads')}
            active={panel === 'threads'}
          >
            <Inbox />
          </HeaderIconButton>
          <HeaderIconButton aria-label="Project settings">
            <Settings2 />
          </HeaderIconButton>
        </Cell>
      </Specimen>
    </Section>
  );
}

type CardState = {
  tone: StoneTone;
  kind: StoneKind;
  stateLabel: string;
  reason: string;
  primary?: string;
};

const CARD_STATES: readonly CardState[] = [
  {
    tone: 'waiting',
    kind: 'question',
    stateLabel: 'Waiting on you',
    reason: 'Asks whether to store the token once on the server or per machine.',
    primary: 'Answer',
  },
  {
    tone: 'waiting',
    kind: 'plan',
    stateLabel: 'Waiting on you',
    reason: 'Plan ready: 4 steps, nothing changes until you approve it.',
    primary: 'Review plan',
  },
  {
    tone: 'working',
    kind: 'running',
    stateLabel: 'Working',
    reason: 'Writing the receipt test · 6 of 9 files read.',
  },
  {
    tone: 'review',
    kind: 'pr',
    stateLabel: 'Ready for review',
    reason: 'PR #2271 opened, CI passed.',
    primary: 'Review PR',
  },
  {
    tone: 'resolved',
    kind: 'done',
    stateLabel: 'Merged',
    reason: 'PR #2271 merged into main.',
  },
];

export function ThreadCardSection() {
  const [index, setIndex] = useState(0);
  const state = CARD_STATES[index] ?? CARD_STATES[0];
  if (state == null) return null;
  return (
    <Section
      id="thread-card"
      title="Thread card"
      lede="The Coordinator stream shows each thread as one card that updates in place: mark, title, state tag, one-line reason, and the next action. Step the state to see it change."
    >
      <Specimen
        title="One card, five states"
        note={`State ${index + 1} of ${CARD_STATES.length}`}
        stage="canvas"
        code={`<ThreadCard\n  title="Connect a Claude subscription"\n  tone="waiting"\n  kind="question"\n  stateLabel="Waiting on you"\n  reason="Asks whether to store the token once or per machine."\n  primaryLabel="Answer"\n/>`}
      >
        <div className="flex w-full max-w-170 flex-col gap-4">
          <ThreadCard
            title="Connect a Claude subscription"
            tone={state.tone}
            kind={state.kind}
            stateLabel={state.stateLabel}
            reason={state.reason}
            primaryLabel={state.primary}
            onPrimary={() => toastSuccess(`${state.primary ?? 'Open'} opened`)}
            onView={() => toastSuccess('Thread opened')}
          />
          <div>
            <Button variant="outline" onClick={() => setIndex((index + 1) % CARD_STATES.length)}>
              Next state
            </Button>
          </div>
        </div>
      </Specimen>
      <Specimen title="All states" stage="canvas" className="flex-col">
        {CARD_STATES.map((s) => (
          <ThreadCard
            key={`${s.tone}${s.kind}`}
            className="max-w-170"
            title="Connect a Claude subscription"
            tone={s.tone}
            kind={s.kind}
            stateLabel={s.stateLabel}
            reason={s.reason}
            primaryLabel={s.primary}
          />
        ))}
      </Specimen>
    </Section>
  );
}

interface DemoThread {
  id: string;
  title: string;
  reason: string;
  tone: StoneTone;
  kind: StoneKind;
  age: string;
  pr?: number;
  snoozed?: boolean;
}

const DEMO_THREADS: readonly DemoThread[] = [
  {
    id: 'a',
    title: 'Connect a Claude subscription',
    reason: 'Asks where to store the token',
    tone: 'waiting',
    kind: 'question',
    age: '4m',
  },
  {
    id: 'b',
    title: 'Snooze until needed',
    reason: 'Wants to run pnpm db:migrate',
    tone: 'waiting',
    kind: 'permission',
    age: '11m',
  },
  {
    id: 'c',
    title: 'Fold finished turns',
    reason: 'PR is ready, CI passed',
    tone: 'review',
    kind: 'pr',
    age: '32m',
    pr: 2271,
  },
  {
    id: 'd',
    title: 'Device receipts',
    reason: 'Writing the receipt test',
    tone: 'working',
    kind: 'running',
    age: '0:42',
  },
  {
    id: 'e',
    title: 'Automation badge and popover',
    reason: 'Snoozed until needed',
    tone: 'idle',
    kind: 'snoozed',
    age: '',
    snoozed: true,
  },
];

export function ThreadRowSection() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(['b']));
  const [waitingCollapsed, setWaitingCollapsed] = useState(false);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const group = (tone: StoneTone) => DEMO_THREADS.filter((t) => t.tone === tone);
  const renderRows = (tone: StoneTone) =>
    group(tone).map((t) => (
      <ThreadRow
        key={t.id}
        title={t.title}
        reason={t.reason}
        tone={t.tone}
        kind={t.kind}
        age={t.age}
        pr={t.pr}
        snoozed={t.snoozed}
        selected={selected.has(t.id)}
        onSelectedChange={(on) => toggle(t.id, on)}
      />
    ));
  return (
    <Section
      id="thread-row"
      title="Thread row and bulk bar"
      lede="The inbox row: mark, title, PR tag, reason and age. Hover reveals a checkbox; waiting rows are raised. Selecting rows floats the bulk bar."
    >
      <Specimen
        title="Inbox trail"
        note="Hover a row, tick the checkbox"
        stage="canvas"
        code={`<ThreadRow title="Fold finished turns" reason="PR is ready" tone="review" kind="pr" pr={2271} age="32m" />\n<BulkBar count={2} onResolve={...} onSnooze={...} onArchive={...} onClear={...} />`}
      >
        <div className="relative w-full max-w-130 overflow-hidden rounded-(--radius-card) bg-background pb-14">
          <StoneTrail>
            <StoneGroup
              tone="waiting"
              label="Waiting on you"
              count={group('waiting').length}
              collapsed={waitingCollapsed}
              onCollapsedChange={setWaitingCollapsed}
            >
              {renderRows('waiting')}
            </StoneGroup>
            <StoneGroup tone="review" label="Ready for review" count={group('review').length}>
              {renderRows('review')}
            </StoneGroup>
            <StoneGroup tone="working" label="Working" count={group('working').length}>
              {renderRows('working')}
            </StoneGroup>
            <StoneGroup tone="idle" label="Idle" count={group('idle').length}>
              {renderRows('idle')}
            </StoneGroup>
          </StoneTrail>
          {selected.size > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <BulkBar
                count={selected.size}
                onResolve={() => {
                  toastSuccess(`Resolved ${selected.size} threads`);
                  setSelected(new Set());
                }}
                onSnooze={() => toastSuccess(`Snoozed ${selected.size} threads`)}
                onArchive={() => toastSuccess(`Archived ${selected.size} threads`)}
                onClear={() => setSelected(new Set())}
              />
            </div>
          )}
        </div>
      </Specimen>
    </Section>
  );
}
