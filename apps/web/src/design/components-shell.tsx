import {
  Activity,
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
import { ListCard, ListRow } from '../components/list-card.js';
import { SegmentedRadio } from '../components/segmented.js';
import { QuotaBar } from '../components/settings/quota-bar.js';
import { RoutingNode } from '../components/settings/routing-node.js';
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
import { ArchivedBanner } from '../components/stream/archived-banner.js';
import { GoalLine } from '../components/stream/goal-line.js';
import { Greeting } from '../components/stream/greeting.js';
import { SuggestionChip } from '../components/stream/suggestion-chip.js';
import { Button } from '../components/ui/button.js';
import { Marker, MarkerContent } from '../components/ui/marker.js';
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
        code={`<SidebarNavRow icon={<Plus />} label="New" shortcut="C" />\n<SidebarProjectRow name="cairn" tone={0} waiting={2} active />\n<SidebarThreadList><SidebarThreadRow title="Snooze until needed" tone="waiting" open /></SidebarThreadList>\n<SidebarUser name="ian" machinesOnline={2} />`}
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
          <div className="px-2 pt-4.5 pb-1.5 text-meta font-medium text-content-tertiary">
            Projects
          </div>
          <SidebarProjectRow
            name="cairn"
            tone={0}
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
  const [tab, setTab] = useState('inbox');
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
              { id: 'coordinator', label: 'Coordinator', icon: <Sparkles className="size-5" /> },
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
      lede="The pieces around the thread cards: a day divider, the goal line, the greeting, suggestion chips, and the archived banner that replaces the composer."
    >
      <Specimen
        title="Stream header"
        note={chip == null ? 'Click a suggestion' : `Picked: ${chip}`}
        stage="canvas"
        code={`<Marker variant="separator"><MarkerContent>Today</MarkerContent></Marker>\n<GoalLine>Bring p95 latency under 200 ms.</GoalLine>\n<Greeting>Morning, ian.</Greeting>\n<SuggestionChip>Make a plan</SuggestionChip>`}
      >
        <div className="flex w-full max-w-170 flex-col gap-4">
          <Marker variant="separator" className="text-meta text-content-tertiary">
            <MarkerContent>Today</MarkerContent>
          </Marker>
          <GoalLine>
            Make Cairn a self-hostable agent team that brings back only what needs you.
          </GoalLine>
          <Greeting>
            Morning, ian. Since last night: 3 threads merged, 2 need you, 2 are running.
          </Greeting>
          <div className="flex flex-wrap gap-2">
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
        stage="canvas"
        code={`<ArchivedBanner message="This project is archived." actionLabel="Unarchive" />`}
      >
        <div className="w-full max-w-170">
          <ArchivedBanner
            message="This project is archived. Threads are read-only and scheduled tasks are paused."
            actionLabel="Unarchive"
            onAction={() => toastSuccess('Unarchived')}
          />
        </div>
      </Specimen>
    </Section>
  );
}

export function RoutingSection() {
  const [mode, setMode] = useState<'subscriptions' | 'payg'>('subscriptions');
  return (
    <Section
      id="routing"
      title="Model routing parts"
      lede="Routing nodes name a job and its model, or a connection and its quota. The bar shows the 5-hour window and turns ochre when a window runs hot."
    >
      <Specimen
        title="Routing nodes and quota bar"
        stage="canvas"
        code={`<RoutingNode name="Claude subscription" detail="max 20x" quota={{ fiveHour: 38, week: 22 }} />\n<QuotaBar percent={86} hot label="Codex five-hour quota" />`}
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-2.5">
              <RoutingNode name="Coordinator" detail="claude-opus-5-5" />
              <RoutingNode
                name="Implementation"
                detail="gpt-6.1-sol"
                note="falls back after quota"
              />
              <RoutingNode name="Mechanical work" detail="claude-haiku-5-5" unavailable />
            </div>
            <div className="flex flex-col gap-2.5">
              <RoutingNode
                name="Claude subscription"
                detail="max 20x"
                quota={{ fiveHour: 38, week: 22 }}
              />
              <RoutingNode name="Codex" detail="pro" quota={{ fiveHour: 86, week: 61 }} />
              <RoutingNode name="OpenRouter key" detail="pay as you go" unavailable />
            </div>
          </div>
          <div className="w-60">
            <QuotaBar percent={54} label="Example quota" />
            <QuotaBar percent={91} hot label="Hot quota" />
          </div>
        </div>
      </Specimen>
    </Section>
  );
}
