import { cn } from 'cn';
import {
  Activity,
  CircleHelp,
  CornerDownLeft,
  FolderSearch,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ProjectAvatar } from '../board/project-avatar.js';
import { EmptyState } from '../components/empty-state.js';
import { ListCard, ListRow } from '../components/list-card.js';
import { NoticeBanner } from '../components/notice-banner.js';
import { SegmentedTabs } from '../components/segmented.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { StoneTrail } from '../components/stone/stone-group.js';
import type { StoneTone } from '../components/stone/tone.js';
import { ToneGlyph } from '../components/stone/tone-glyph.js';
import { Greeting } from '../components/stream/greeting.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_FACE } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { Kbd } from '../components/ui/kbd.js';
import { MENU_ITEM_CLS, MENU_SURFACE_CLS } from '../components/ui/menu.js';
import { GROUP_LABEL, ROW_BASE, ROW_END, ROW_LIT } from '../overlay/search-panel.js';
import { SHEET_PANEL } from '../pages/shell.js';
import { DraftNote, OptionTitle, PhoneFrame, Shot } from './proposals-parts.js';
import { Section, Specimen } from './specimen.js';

interface Token {
  key: string;
  value: string;
  invalid?: boolean;
}

interface Hit {
  title: string;
  tone: StoneTone;
  project: string;
  tone6: number;
  seq: number;
  cost: string;
  age: string;
  reason: string;
  pr?: number;
}

const HITS: Hit[] = [
  {
    title: 'Fold finished turns in the transcript',
    tone: 'failed',
    project: 'cairn',
    tone6: 0,
    seq: 431,
    cost: '$1.84',
    age: '32m',
    reason: 'Build failed: typecheck',
    pr: 2271,
  },
  {
    title: 'Flip detector',
    tone: 'failed',
    project: 'cairn',
    tone6: 0,
    seq: 377,
    cost: '$0.62',
    age: '3h',
    reason: 'Auto-disabled after 10 runs',
  },
  {
    title: 'Move routing rules behind the work policy',
    tone: 'failed',
    project: 'cairn',
    tone6: 0,
    seq: 402,
    cost: '$4.10',
    age: 'Yesterday',
    reason: 'Review gate red',
    pr: 2717,
  },
  {
    title: 'Trim the gallery frame',
    tone: 'working',
    project: 'cairn',
    tone6: 0,
    seq: 438,
    cost: '$0.31',
    age: '5m',
    reason: 'Building',
  },
  {
    title: 'Dependency bump',
    tone: 'waiting',
    project: 'docs-site',
    tone6: 2,
    seq: 120,
    cost: '$0.08',
    age: '1h',
    reason: 'Waiting on your answer',
  },
  {
    title: 'Weekly flaky-test sweep',
    tone: 'resolved',
    project: 'infra',
    tone6: 4,
    seq: 88,
    cost: '$2.47',
    age: '2d',
    reason: 'Merged',
  },
];

const RECENT = HITS.slice(0, 3);

function TokenChip({ token }: { token: Token }) {
  return (
    <span
      data-invalid={token.invalid ? '' : undefined}
      className={cn(
        'inline-flex h-6 flex-none items-center gap-0.5 rounded-(--cds-radius-md) bg-secondary pr-1 pl-2 text-meta',
        token.invalid && 'text-destructive ring-1 ring-destructive/40',
      )}
    >
      <span className={token.invalid ? '' : 'text-content-tertiary'}>{token.key}:</span>
      <span className={cn('font-medium', !token.invalid && 'text-foreground')}>{token.value}</span>
      <button
        type="button"
        aria-label={`Remove ${token.key}`}
        className="flex size-4.5 flex-none items-center justify-center rounded-sm text-content-tertiary hover:bg-(--menu-hover) hover:text-foreground"
      >
        <X width={12} height={12} />
      </button>
    </span>
  );
}

function SyntaxHelp({ className }: { className?: string }) {
  const rows: [string, string, string][] = [
    ['is:', 'failed, waiting, review, running, done, snoozed', 'is:failed'],
    ['project:', 'A project name', 'project:cairn'],
    ['pr:', 'A pull request number, or any', 'pr:2271'],
    ['by:', 'The agent or person who started it', 'by:builder'],
    ['after:', 'A date or a span back from now', 'after:7d'],
    ['cost:', 'Spend, with > or <', 'cost:>5'],
  ];
  return (
    <div className={cn(MENU_SURFACE_CLS, 'flex flex-col gap-2 p-3', className)}>
      <div className="flex items-center gap-2">
        <h3 className="m-0 flex-1 text-ui font-medium text-foreground">Search filters</h3>
        <span className="text-caption text-content-tertiary">Combine any; they all apply</span>
      </div>
      <dl className="m-0 grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5">
        {rows.map(([key, meaning, example]) => (
          <div key={key} className="contents">
            <dt className="font-mono text-code text-foreground">{key}</dt>
            <dd className="m-0 text-meta text-content-secondary">{meaning}</dd>
            <dd className="m-0 font-mono text-code text-content-tertiary">{example}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 border-t border-border pt-2 text-meta text-content-tertiary">
        Words without a filter match titles. Prefix a filter with{' '}
        <span className="font-mono">-</span> to exclude it.
      </p>
    </div>
  );
}

function HitRow({ hit, selected, compact }: { hit: Hit; selected?: boolean; compact?: boolean }) {
  return (
    <Button
      variant="ghost"
      data-selected={selected ? '' : undefined}
      className={cn(ROW_BASE, 'hover:bg-(--menu-hover)', selected && ROW_LIT)}
    >
      <ToneGlyph tone={hit.tone} still />
      <span className="min-w-0 truncate">{hit.title}</span>
      <span className={ROW_END}>
        {!compact && (
          <>
            <ProjectAvatar name={hit.project} tone={hit.tone6} bare />
            <span className="max-w-24 truncate">{hit.project}</span>
            <span className="w-11 text-right font-mono text-code tabular-nums">{hit.cost}</span>
          </>
        )}
        <span className="w-14 text-right tabular-nums">{hit.age}</span>
      </span>
    </Button>
  );
}

function NavRow({ icon, label, hint }: { icon: ReactNode; label: string; hint?: string }) {
  return (
    <Button variant="ghost" className={cn(ROW_BASE, 'hover:bg-(--menu-hover)')}>
      {icon}
      {label}
      {hint != null && <span className={ROW_END}>{hint}</span>}
    </Button>
  );
}

function PaletteFace({
  tokens = [],
  text = '',
  view,
  compact,
}: {
  tokens?: Token[];
  text?: string;
  view: 'empty' | 'results' | 'none';
  compact?: boolean;
}) {
  const filtered = view === 'results';
  return (
    <div
      className={cn('flex max-h-120 w-full flex-col overflow-hidden', DIALOG_FACE)}
      role="dialog"
      aria-label="Search"
    >
      <div className="flex min-h-12 flex-none flex-wrap items-center gap-1.5 border-b border-border px-4 py-2 text-content-tertiary">
        <Search width={16} height={16} className="flex-none" />
        {tokens.map((token) => (
          <TokenChip key={token.key + token.value} token={token} />
        ))}
        <Input
          aria-label="Search"
          readOnly
          value={text}
          placeholder={
            tokens.length === 0
              ? 'Search threads, projects, people. Try is:failed'
              : 'Add a filter or words'
          }
          className="h-auto min-w-24 flex-1 rounded-none border-none bg-transparent p-0 text-card-title leading-5 text-foreground shadow-none ring-0 placeholder:text-content-tertiary focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent md:text-card-title"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-1 pb-1.5">
        {view === 'empty' && (
          <>
            <div className={GROUP_LABEL}>Recent threads</div>
            {RECENT.map((hit, index) => (
              <HitRow key={hit.seq} hit={hit} selected={index === 0} compact={compact} />
            ))}
            <div className={GROUP_LABEL}>Projects</div>
            <NavRow
              icon={<ProjectAvatar name="cairn" tone={0} bare />}
              label="cairn"
              hint={compact ? undefined : '6 open'}
            />
            <NavRow
              icon={<ProjectAvatar name="docs-site" tone={2} bare />}
              label="docs-site"
              hint={compact ? undefined : '1 open'}
            />
            <div className={GROUP_LABEL}>Actions</div>
            <NavRow icon={<Plus width={15} height={15} />} label="New thread" hint="N" />
            <NavRow
              icon={<Activity width={15} height={15} />}
              label="View all activity"
              hint="G A"
            />
          </>
        )}
        {view === 'results' && (
          <>
            <div className={GROUP_LABEL}>Threads · 3 match</div>
            {HITS.slice(0, 3).map((hit, index) => (
              <HitRow key={hit.seq} hit={hit} selected={index === 0} compact={compact} />
            ))}
            <div className={GROUP_LABEL}>Not what you wanted?</div>
            <NavRow
              icon={<Activity width={15} height={15} />}
              label="View all 3 in Activity"
              hint="⌘↵"
            />
          </>
        )}
        {view === 'none' && (
          <div className="flex flex-col gap-2 px-3 py-6">
            <p className="m-0 text-ui text-foreground">No threads match all of these filters</p>
            <p className="m-0 text-meta text-content-tertiary">
              The newest thread in cairn is from 6 days ago. Drop a filter to widen the search.
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              <Button size="sm" variant="outline">
                Drop after:2026-12-01
              </Button>
              <Button size="sm" variant="ghost" className="text-content-secondary">
                Clear all filters
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex h-9 flex-none items-center gap-4 border-t border-border px-3.5 text-caption text-content-tertiary">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          Move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          Open
        </span>
        {!compact && (
          <span className="min-w-0 truncate whitespace-nowrap font-mono">
            {filtered ? 'Tab completes a filter' : 'is: project: pr: by: after: cost:'}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="xs" className="text-content-tertiary">
            <CircleHelp data-icon="inline-start" />
            Syntax
          </Button>
          <Kbd>Esc</Kbd>
        </span>
      </div>
    </div>
  );
}

const FAILED_IN_CAIRN: Token[] = [
  { key: 'is', value: 'failed' },
  { key: 'project', value: 'cairn' },
];

export function ProposalPaletteSection() {
  return (
    <Section
      id="draft-palette"
      title="#2326 Command palette with search syntax"
      lede="The palette keeps its shape. Typed filters become chips in the field, results show project and cost, and the footer teaches the syntax. Rows reuse the palette's own row classes."
    >
      <Specimen
        title="Palette states"
        note="Empty, filtered, syntax help, no results"
        stage="canvas"
        className="flex-col flex-nowrap"
      >
        <Shot id="palette-states" className="grid w-full grid-cols-2 gap-6 max-[900px]:grid-cols-1">
          <div className="flex flex-col gap-2">
            <span className="text-caption text-content-tertiary">
              Empty: recent threads, projects, actions
            </span>
            <PaletteFace view="empty" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-caption text-content-tertiary">
              Typed is:failed project:cairn
            </span>
            <PaletteFace view="results" tokens={FAILED_IN_CAIRN} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-caption text-content-tertiary">
              Syntax help, opened from the footer
            </span>
            <div className="flex flex-col gap-2">
              <PaletteFace view="results" tokens={[FAILED_IN_CAIRN[0] as Token]} text="cost:" />
              <SyntaxHelp className="w-full" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-caption text-content-tertiary">
              No results, with an invalid value flagged
            </span>
            <PaletteFace
              view="none"
              tokens={[
                { key: 'is', value: 'failed' },
                { key: 'project', value: 'cairn' },
                { key: 'after', value: '2026-12-01' },
                { key: 'cost', value: 'lots', invalid: true },
              ]}
            />
          </div>
        </Shot>
        <Shot id="palette-phone" className="items-start">
          <span className="text-card-title font-semibold text-foreground">
            Phone: the palette becomes a full-height sheet
          </span>
          <PhoneFrame>
            <div className="flex-1 bg-(--dialog-backdrop) p-2 pt-8">
              <PaletteFace view="results" tokens={FAILED_IN_CAIRN} compact />
            </div>
          </PhoneFrame>
        </Shot>
      </Specimen>
    </Section>
  );
}

function FilterBar({ tokens, compact }: { tokens: Token[]; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-1 text-content-tertiary dark:bg-input/30">
        <Search width={14} height={14} className="flex-none" />
        {tokens.map((token) => (
          <TokenChip key={token.key + token.value} token={token} />
        ))}
        <Input
          aria-label="Filter activity"
          readOnly
          placeholder="Add words or a filter"
          className="h-6 min-w-24 flex-1 rounded-none border-none bg-transparent p-0 text-ui text-foreground shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent md:text-ui"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Syntax help"
          className="text-content-tertiary"
        >
          <CircleHelp />
        </Button>
      </div>
      <div className={cn('flex items-center gap-1.5', compact && 'overflow-x-auto')}>
        {['Failed', 'Waiting on you', 'Review', 'Last 7 days', 'Over $1'].map((label) => (
          <Button
            key={label}
            variant="outline"
            size="sm"
            className="flex-none rounded-full text-content-secondary"
          >
            {label}
          </Button>
        ))}
        <Button variant="ghost" size="sm" className="flex-none text-content-secondary">
          <Plus data-icon="inline-start" />
          Filter
        </Button>
      </div>
    </div>
  );
}

function ActivityRows({ compact }: { compact?: boolean }) {
  return (
    <StoneTrail className="px-2">
      <div className="flex items-baseline gap-2 px-2 pt-1 pb-1">
        <span className="text-caption font-medium text-content-tertiary">Today</span>
        <span className="text-caption text-content-tertiary">3 threads · $2.77</span>
      </div>
      {HITS.slice(0, 3).map((hit) => (
        <ThreadRow
          key={hit.seq}
          title={hit.title}
          tone={hit.tone}
          {...(hit.pr == null ? {} : { pr: hit.pr })}
          age={hit.age}
          reason={
            <span className="inline-flex items-center gap-1.5">
              <ToneGlyph tone={hit.tone} still />
              <ProjectAvatar name={hit.project} tone={hit.tone6} bare />
              {hit.project}
              {!compact && <span aria-hidden>·</span>}
              {!compact && hit.reason}
              <span aria-hidden>·</span>
              <span className="font-mono text-code">{hit.cost}</span>
            </span>
          }
        />
      ))}
      <div className="flex items-baseline gap-2 px-2 pt-3 pb-1">
        <span className="text-caption font-medium text-content-tertiary">Earlier this week</span>
        <span className="text-caption text-content-tertiary">3 threads · $2.86</span>
      </div>
      {HITS.slice(3).map((hit) => (
        <ThreadRow
          key={hit.seq}
          title={hit.title}
          tone={hit.tone}
          age={hit.age}
          reason={
            <span className="inline-flex items-center gap-1.5">
              <ToneGlyph tone={hit.tone} still />
              <ProjectAvatar name={hit.project} tone={hit.tone6} bare />
              {hit.project}
              <span aria-hidden>·</span>
              <span className="font-mono text-code">{hit.cost}</span>
            </span>
          }
        />
      ))}
    </StoneTrail>
  );
}

function ActivityPage({ compact }: { compact?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 flex-none items-center gap-3 border-b border-border px-5 max-[640px]:pl-14">
        <h1 className="m-0 mr-auto font-serif text-page font-semibold text-foreground">Activity</h1>
        <span className="text-meta text-content-tertiary">318 threads · $142.60 this month</span>
      </header>
      <FilterBar compact={compact} tokens={[{ key: 'is', value: 'failed' }]} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <ActivityRows compact={compact} />
        <p className="m-0 px-4 pt-3 text-meta text-content-tertiary">Showing 6 of 42 · Load more</p>
      </div>
    </div>
  );
}

function UserMenuStub() {
  return (
    <div className={cn(MENU_SURFACE_CLS, 'flex w-56 flex-col')}>
      <div className="px-2.5 pt-1.5 pb-1 text-meta text-content-tertiary">ian</div>
      <div className={MENU_ITEM_CLS}>Settings</div>
      <div className={cn(MENU_ITEM_CLS, 'bg-(--menu-hover)')}>
        <Activity />
        Activity
      </div>
      <div className="mx-2.5 my-1 h-px bg-border" />
      <div className={MENU_ITEM_CLS}>Sign out</div>
    </div>
  );
}

export function ProposalActivitySection() {
  const [mode, setMode] = useState<'mine' | 'activity'>('activity');
  return (
    <Section
      id="draft-activity"
      title="#2326 Activity: every thread across projects"
      lede="One list with the palette's filter syntax in a chip row. The decision is where it lives."
    >
      <Specimen
        title="A. A route: View all from the palette and the user menu"
        note="/app/activity; a filtered palette hands its tokens over"
        stage="canvas"
        className="flex-col flex-nowrap"
      >
        <Shot id="activity-a" className="w-full flex-row items-start gap-6 max-[1000px]:flex-col">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <OptionTitle option="A" title="Activity page" />
            <div className={cn(SHEET_PANEL, 'm-0 h-170 flex-none flex-col')}>
              <ActivityPage />
            </div>
          </div>
          <div className="flex w-72 flex-none flex-col gap-4">
            <span className="text-caption text-content-tertiary">Entry points</span>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col overflow-hidden rounded-(--radius-popover) bg-popover p-1 shadow-(--shadow-popover)">
                <NavRow
                  icon={<Activity width={15} height={15} />}
                  label="View all 42 in Activity"
                  hint="⌘↵"
                />
              </div>
              <span className="text-caption text-content-tertiary">
                Palette footer row, carrying the filters
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <UserMenuStub />
              <span className="text-caption text-content-tertiary">User menu</span>
            </div>
            <DraftNote>
              The sidebar stays as is: no extra nav row for a page that is a search result.
            </DraftNote>
          </div>
        </Shot>
        <Shot id="activity-a-phone" className="items-start">
          <OptionTitle option="A" title="Phone" />
          <PhoneFrame>
            <ActivityPage compact />
          </PhoneFrame>
        </Shot>
      </Specimen>
      <Specimen
        title="B. A mode inside the tasks panel"
        note="The panel gets a Mine / Activity switch; no new route"
        stage="canvas"
        className="flex-col flex-nowrap"
      >
        <Shot id="activity-b" className="w-full">
          <OptionTitle option="B" title="Tasks panel, Activity mode" />
          <div className="relative flex h-170 justify-end overflow-hidden rounded-(--radius-card) bg-background ring-1 ring-border">
            <div className="flex min-w-0 flex-1 items-start p-8">
              <Greeting>Good afternoon, ian</Greeting>
            </div>
            <SidePanel label="Threads" onDismiss={() => undefined}>
              <SidePanelHead closeLabel="Close panel" onClose={() => undefined}>
                <SidePanelTitle>Threads</SidePanelTitle>
                <SegmentedTabs
                  label="Panel mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'mine', label: 'Mine' },
                    { value: 'activity', label: 'Activity' },
                  ]}
                />
              </SidePanelHead>
              <FilterBar compact tokens={[{ key: 'is', value: 'failed' }]} />
              <div className="min-h-0 flex-1 overflow-y-auto pb-4">
                <ActivityRows compact />
              </div>
            </SidePanel>
          </div>
          <DraftNote>
            The panel is 420px, so project and cost squeeze into the reason line and the day groups
            carry the totals. Deep links to a filtered view need a query string on whatever route is
            open.
          </DraftNote>
        </Shot>
      </Specimen>
      <Specimen
        title="Project not found"
        note="Today an unknown ?project= silently falls back to the Coordinator home"
        stage="canvas"
        className="flex-col flex-nowrap"
      >
        <Shot id="notfound" className="w-full grid-cols-2 gap-6 lg:grid">
          <div className="flex flex-col gap-2">
            <OptionTitle option="A" title="Blocking page" />
            <div
              className={cn(
                SHEET_PANEL,
                'm-0 h-120 flex-none flex-col items-center justify-center overflow-y-auto',
              )}
            >
              <EmptyState
                icon={FolderSearch}
                title="That project is not here"
                description="No project matches “cairn-old”. It may have been deleted, renamed, or you may not be on its team."
                action={{ label: 'Open the Coordinator' }}
              />
              <ListCard className="mb-6 w-80">
                <ListRow
                  icon={<ProjectAvatar name="cairn" tone={0} bare />}
                  title="cairn"
                  subtitle="Maybe this one?"
                />
                <ListRow
                  icon={<ProjectAvatar name="docs-site" tone={2} bare />}
                  title="docs-site"
                />
              </ListCard>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <OptionTitle option="B" title="Banner over the Coordinator home" />
            <div className={cn(SHEET_PANEL, 'm-0 h-120 flex-none flex-col gap-6 p-6')}>
              <NoticeBanner
                tone="warning"
                icon={SlidersHorizontal}
                title="Project “cairn-old” was not found"
                body="Showing the Coordinator instead. The link may point at a deleted or renamed project."
                actions={
                  <Button size="sm" variant="outline">
                    Dismiss
                  </Button>
                }
                className="shadow-none ring-1 ring-border"
              />
              <Greeting>Good afternoon, ian</Greeting>
              <Button
                variant="outline"
                className="h-11 w-full max-w-160 justify-start gap-2 rounded-xl bg-card font-normal text-content-secondary shadow-(--e1)"
              >
                <CornerDownLeft aria-hidden className="size-4" />
                Ask the Coordinator
              </Button>
            </div>
          </div>
        </Shot>
      </Specimen>
    </Section>
  );
}
