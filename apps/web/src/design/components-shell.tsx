import {
  Activity,
  Archive,
  Clock,
  FolderGit2,
  Inbox,
  LayoutGrid,
  Moon,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { SpiralMark } from '../chief/chief-fab-icon.js';
import { ListCard, ListRow } from '../components/list-card.js';
import { NoticeBanner } from '../components/notice-banner.js';
import { SegmentedRadio } from '../components/segmented.js';
import {
  type RoutingConnection,
  RoutingGraph,
  type RoutingJob,
} from '../components/settings/routing-graph.js';
import { SettingsDangerZone } from '../components/settings-list.js';
import { PhoneTabBar } from '../components/shell/phone-tab-bar.js';
import { ArchivedProjectCard, ProjectCard } from '../components/shell/project-card.js';
import { SidebarNavRow } from '../components/shell/sidebar-nav-row.js';
import {
  SidebarProjectRow,
  SidebarThreadList,
  SidebarThreadRow,
} from '../components/shell/sidebar-project.js';
import { SidebarUser } from '../components/shell/sidebar-user.js';
import { GoalLine } from '../components/stream/goal-line.js';
import { Greeting } from '../components/stream/greeting.js';
import { StreamDigest } from '../components/stream/stream-digest.js';
import { SuggestionChip } from '../components/stream/suggestion-chip.js';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { Section, Specimen } from './specimen.js';

export function SidebarSection() {
  const [active, setActive] = useState('cairn');
  return (
    <Section
      id="sidebar"
      title="Sidebar parts"
      lede="The sidebar sits on the canvas: nav rows with key hints, project rows with a waiting count, the open project's nested thread rows on a dashed trail, and the user footer."
    >
      <Specimen
        title="Sidebar"
        note="Click a project"
        stage="canvas"
        code={`<SidebarNavRow icon={<Plus />} label="New" shortcut="C" />\n<SidebarProjectRow name="cairn" tone={0} waiting={2} active />\n<SidebarThreadList><SidebarThreadRow title="Snooze until needed" tone="waiting" open /></SidebarThreadList>\n<SidebarUser name="ian" avatar={<SeededAvatar name="ian" fallback="/avatar-user.png" className="size-6" />} machinesOnline={2} />`}
      >
        <div className="flex w-62 flex-col gap-0.5 py-1">
          <SidebarNavRow icon={<Plus className="size-4" />} label="New" shortcut="C" />
          <SidebarNavRow icon={<Search className="size-4" />} label="Search" shortcut="⌘K" />
          <SidebarNavRow icon={<LayoutGrid className="size-4" />} label="Projects" />
          <SidebarNavRow
            icon={<Clock className="size-4" />}
            label="Scheduled"
            active={active === 'scheduled'}
            onClick={() => setActive('scheduled')}
          />
          <SidebarNavRow icon={<Activity className="size-4" />} label="Activity" />
          <div className="flex items-center px-2 pt-4.5 pb-1.5 text-meta font-medium text-content-tertiary">
            Projects
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="New project"
              className="ml-auto text-content-tertiary"
              onClick={() => toastSuccess('New project')}
            >
              <Plus />
            </Button>
          </div>
          <SidebarProjectRow
            name="cairn"
            tone={0}
            icon="mountain"
            color="moss"
            waiting={2}
            active={active === 'cairn'}
            onClick={() => setActive('cairn')}
          />
          {active === 'cairn' && (
            <SidebarThreadList>
              <SidebarThreadRow
                title="Connect a Claude subscription"
                tone="waiting"
                onClick={() => undefined}
              />
              <SidebarThreadRow
                title="Snooze until needed and an unreasonably long title that truncates"
                tone="working"
                open
              />
              <SidebarThreadRow title="Fold finished turns" tone="review" />
              <SidebarThreadRow title="Automation badge and popover" tone="idle" snoozed />
            </SidebarThreadList>
          )}
          <SidebarProjectRow
            name="api-latency"
            tone={2}
            icon="server"
            color="slate"
            active={active === 'api'}
            onClick={() => setActive('api')}
          />
          <SidebarProjectRow
            name="docs-site"
            tone={3}
            waiting={1}
            active={active === 'docs'}
            onClick={() => setActive('docs')}
          />
          <SidebarUser
            avatar={<SeededAvatar name="ian" fallback="/avatar-user.png" className="size-6" />}
            name="ian"
            machinesOnline={2}
            action={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Toggle theme"
                onClick={() => toastSuccess('Theme toggled')}
              >
                <Moon />
              </Button>
            }
          />
        </div>
      </Specimen>
    </Section>
  );
}

export function ProjectsSection() {
  const [tab, setTab] = useState('coordinator');
  return (
    <Section
      id="projects-lists"
      title="Project card, list rows and phone tab bar"
      lede="The Projects page card, the shared list row used by Library, activity and settings lists, and the phone tab bar with an inbox badge."
    >
      <Specimen
        title="Project cards"
        stage="canvas"
        code={`<ProjectCard name="cairn" tone={0} repo="xiechimon/cairn" created="Oct 2" goal="…" waiting={2} running={2} threads={11} merged={34} />`}
      >
        <div className="grid w-full max-w-190 grid-cols-1 gap-3 md:grid-cols-2">
          <ProjectCard
            name="cairn"
            tone={0}
            icon="mountain"
            color="moss"
            repo="xiechimon/cairn"
            created="Oct 2"
            goal="Make Cairn a self-hostable agent team that works through a backlog while you sleep and brings back only what needs you."
            waiting={2}
            running={2}
            threads={11}
            merged={34}
            onOpen={() => toastSuccess('cairn opened')}
          />
          <ProjectCard
            name="api-latency"
            tone={2}
            icon="server"
            color="slate"
            repo="xiechimon/api"
            created="Oct 19"
            goal="Bring p95 latency under 200 ms across the whole API."
            waiting={0}
            running={0}
            threads={3}
            merged={1}
          />
          <ArchivedProjectCard name="old-site" tone={5} note="Archived Oct 28 · 8 threads" />
        </div>
      </Specimen>
      <Specimen
        title="List rows"
        stage="canvas"
        code={`<ListCard>\n  <ListRow icon={<FileText />} title="plan-b2.md" subtitle="Coordinator · 12 KB" trailing="2h ago" />\n</ListCard>`}
      >
        <ListCard className="w-full max-w-130">
          <ListRow
            icon={<Inbox className="size-4" />}
            title="batch-b2-plan.md"
            subtitle="Coordinator · 12 KB"
            trailing="2h ago"
          />
          <ListRow
            icon={<FolderGit2 className="size-4" />}
            title="screenshots"
            subtitle="Thread 2235 · 6 files"
            trailing="Yesterday"
          />
          <ListRow
            icon={<Sparkles className="size-4" />}
            title="weekly-report.md"
            subtitle="Scheduled task · 3 KB"
            trailing="Oct 27"
          />
        </ListCard>
      </Specimen>
      <Specimen
        title="Phone tab bar"
        note="62px, badge counts what waits on you"
        stage="canvas"
        code={`<PhoneTabBar active="inbox" tabs={[{ id: 'inbox', label: 'Inbox', icon: <Inbox />, badge: 2 }]} />`}
      >
        <div className="w-93.75 overflow-hidden rounded-(--radius-card) bg-background shadow-(--e1)">
          <PhoneTabBar
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'inbox', label: 'Inbox', icon: <Inbox className="size-5" />, badge: 2 },
              {
                id: 'coordinator',
                label: 'Coordinator',
                icon: <SpiralMark busy={false} className="size-5" />,
              },
              { id: 'projects', label: 'Projects', icon: <LayoutGrid className="size-5" /> },
            ]}
          />
        </div>
      </Specimen>
      <Specimen
        title="Settings danger zone"
        note="The existing SettingsDangerZone row with the danger outline"
        stage="canvas"
        code={`<SettingsDangerZone label="Delete project" description="…" actionLabel="Delete…" className="ring-danger-line" />`}
      >
        <div className="flex w-full max-w-170 flex-col gap-3">
          <SettingsDangerZone
            className="ring-danger-line"
            label="Delete project"
            description="Deletes threads, Library files and scheduled tasks. Merged PRs stay on GitHub."
            actionLabel="Delete…"
          />
        </div>
      </Specimen>
    </Section>
  );
}

export function CoordinatorStreamSection() {
  const [chip, setChip] = useState<string | null>(null);
  return (
    <Section
      id="coordinator"
      title="Coordinator stream parts"
      lede="The pieces around the thread cards: the goal line, the greeting, clickable status rows, quiet suggestions, and the archived banner that replaces the composer."
    >
      <Specimen
        title="Stream header"
        note={chip == null ? 'Click a row or a suggestion' : `Picked: ${chip}`}
        code={`<GoalLine onEdit={edit}>Bring p95 latency under 200 ms.</GoalLine>\n<Greeting since="Since last night">Morning, ian.</Greeting>\n<StreamDigest rows={[{ tone: 'waiting', count: 2, label: 'need you', onSelect }]} />\n<SuggestionChip>Make a plan</SuggestionChip>`}
      >
        <div className="flex w-full max-w-170 flex-col gap-3.5">
          <GoalLine onEdit={() => toastSuccess('Edit goal')}>
            Make Cairn a self-hostable agent team that brings back only what needs you.
          </GoalLine>
          <Greeting since="Since last night">Morning, ian.</Greeting>
          <StreamDigest
            className="max-w-90"
            rows={[
              { tone: 'waiting', count: 2, label: 'need you', onSelect: () => setChip('need you') },
              { tone: 'working', count: 2, label: 'running', onSelect: () => setChip('running') },
              { tone: 'resolved', count: 3, label: 'merged', onSelect: () => setChip('merged') },
            ]}
          />
          <div className="-mx-2.5 flex flex-wrap gap-1">
            {['Make a plan', 'Add a repo', 'Pick up recent work', 'Use my tools'].map((label) => (
              <SuggestionChip key={label} onClick={() => setChip(label)}>
                {label}
              </SuggestionChip>
            ))}
          </div>
        </div>
      </Specimen>
      <Specimen
        title="Archived banner"
        code={`<NoticeBanner tone="waiting" icon={Archive} title="This project is archived." actions={<Button size="sm">Unarchive</Button>} />`}
      >
        <div className="w-full max-w-170">
          <NoticeBanner
            tone="waiting"
            icon={Archive}
            title="This project is archived."
            body="Threads are read-only and scheduled tasks are paused."
            actions={
              <Button size="sm" onClick={() => toastSuccess('Unarchived')}>
                Unarchive
              </Button>
            }
          />
        </div>
      </Specimen>
    </Section>
  );
}

const ROUTING_JOBS: RoutingJob[] = [
  {
    id: 'coordinator',
    name: 'Coordinator',
    model: 'claude-opus-5-5',
    tone: 1,
    connectionId: 'claude',
  },
  {
    id: 'implementation',
    name: 'Implementation',
    model: 'gpt-6.1-sol',
    tone: 3,
    connectionId: 'codex',
  },
  { id: 'review', name: 'Review', model: 'claude-sonnet-5-5', tone: 4, connectionId: 'claude' },
  {
    id: 'mechanical',
    name: 'Mechanical work',
    model: 'claude-haiku-5-5',
    tone: 2,
    unavailable: true,
  },
];

const ROUTING_CONNECTIONS: RoutingConnection[] = [
  { id: 'claude', name: 'Claude subscription', tier: 'Max 20x', quota: { fiveHour: 38, week: 22 } },
  { id: 'codex', name: 'Codex', tier: 'Pro', quota: { fiveHour: 86, week: 61 } },
  { id: 'openrouter', name: 'OpenRouter key', unavailable: true },
];

export function RoutingSection() {
  const [mode, setMode] = useState<'subscriptions' | 'payg'>('subscriptions');
  return (
    <Section
      id="routing"
      title="Model routing parts"
      lede="Jobs on the left name their model; a curve runs to the connection that serves them, which shows its 5-hour and weekly quota. A bar turns ochre from 80%."
    >
      <Specimen
        title="Routing nodes and quota bar"
        stage="canvas"
        code={`<RoutingGraph jobs={[{ id: 'coordinator', name: 'Coordinator', model: 'claude-opus-5-5', tone: 1, connectionId: 'claude' }]} connections={[{ id: 'claude', name: 'Claude subscription', tier: 'Max 20x', quota: { fiveHour: 38, week: 22 } }]} />`}
      >
        <div className="flex w-full max-w-170 flex-col gap-4">
          <SegmentedRadio
            label="Routing mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'subscriptions', label: 'Subscriptions only' },
              { value: 'payg', label: 'Allow pay as you go' },
            ]}
          />
          <RoutingGraph jobs={ROUTING_JOBS} connections={ROUTING_CONNECTIONS} />
        </div>
      </Specimen>
    </Section>
  );
}
