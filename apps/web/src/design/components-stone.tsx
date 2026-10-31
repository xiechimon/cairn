import { Inbox, Library, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { HeaderIconButton } from '../components/shell/header-icon-button.js';
import { WaitPill } from '../components/shell/wait-pill.js';
import { StoneGroup, StoneTrail } from '../components/stone/stone-group.js';
import { STONE_TONES, type StoneTone } from '../components/stone/tone.js';
import { ToneGlyph } from '../components/stone/tone-glyph.js';
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
      lede="Five groups carry the inbox in a fixed order: waiting on you, ready for review, working, idle, resolved. A state is drawn once per context: the group header carries the glyph and its rows carry none; a row outside a group carries its own. The reason is written, not iconised."
    >
      <Specimen
        title="Tone glyph"
        note="The status glyph family, one per tone; working is the spiral trace"
        code={`<ToneGlyph tone="waiting" />\n<ToneGlyph tone="working" still />`}
      >
        {STONE_TONES.map((tone) => (
          <Cell key={tone} label={tone}>
            <ToneGlyph tone={tone} />
          </Cell>
        ))}
        <Cell label="working, still">
          <ToneGlyph tone="working" still />
        </Cell>
      </Specimen>
      <Specimen
        title="Stone trail"
        note="Group header: glyph, label, count, collapse chevron; an empty group says so in one line"
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
  stateLabel: string;
  reason: string;
  primary?: string;
};

const CARD_STATES: readonly CardState[] = [
  {
    tone: 'waiting',
    stateLabel: 'Waiting on you',
    reason: 'Question · whether to store the token once on the server or per machine.',
    primary: 'Answer',
  },
  {
    tone: 'waiting',
    stateLabel: 'Waiting on you',
    reason: 'Plan · 4 steps, nothing changes until you approve it.',
    primary: 'Review plan',
  },
  {
    tone: 'working',
    stateLabel: 'Working',
    reason: 'Writing the receipt test · 6 of 9 files read.',
  },
  {
    tone: 'review',
    stateLabel: 'Ready for review',
    reason: 'PR #2271 opened, CI passed.',
    primary: 'Review PR',
  },
  {
    tone: 'resolved',
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
      lede="The Coordinator stream shows each thread as one card that updates in place: glyph, title, one-line reason, and the next action. The glyph is the state; there is no second state tag. Step the state to see it change."
    >
      <Specimen
        title="One card, five states"
        note={`State ${index + 1} of ${CARD_STATES.length}`}
        stage="canvas"
        code={`<ThreadCard\n  title="Connect a Claude subscription"\n  tone="waiting"\n  stateLabel="Waiting on you"\n  reason="Asks whether to store the token once or per machine."\n  primaryLabel="Answer"\n/>`}
      >
        <div className="flex w-full max-w-170 flex-col gap-4">
          <ThreadCard
            title="Connect a Claude subscription"
            tone={state.tone}
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
            key={s.reason}
            className="max-w-170"
            title="Connect a Claude subscription"
            tone={s.tone}
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
  age: string;
  pr?: number;
  snoozed?: boolean;
}

const DEMO_THREADS: readonly DemoThread[] = [
  {
    id: 'a',
    title: 'Connect a Claude subscription',
    reason: 'Question · where to store the token',
    tone: 'waiting',
    age: '4m',
  },
  {
    id: 'b',
    title: 'Run the schedules migration',
    reason: 'Permission · wants to run pnpm db:migrate',
    tone: 'waiting',
    age: '11m',
  },
  {
    id: 'c',
    title: 'Fold finished turns',
    reason: 'CI passed',
    tone: 'review',
    age: '32m',
    pr: 2271,
  },
  {
    id: 'd',
    title: 'Device receipts',
    reason: 'Writing the receipt test',
    tone: 'working',
    age: '0:42',
  },
  {
    id: 'e',
    title: 'Automation badge and popover',
    reason: 'Snoozed until needed',
    tone: 'idle',
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
      lede="The inbox row inside a group: title, PR number, reason and age, no glyph of its own. Hover reveals a checkbox in the left gutter; selecting rows floats the bulk bar."
    >
      <Specimen
        title="Inbox trail"
        note="Hover a row, tick the checkbox"
        stage="canvas"
        code={`<ThreadRow title="Fold finished turns" reason="PR is ready" tone="review" pr={2271} age="32m" />\n<BulkBar count={2} onResolve={...} onSnooze={...} onArchive={...} onClear={...} />`}
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
