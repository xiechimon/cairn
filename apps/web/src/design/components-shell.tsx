import { Archive, CalendarClock, FolderGit2, Inbox, LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import { BrandGlyph } from '../components/brand-glyph.js';
import { ListCard, ListRow } from '../components/list-card.js';
import { NoticeBanner } from '../components/notice-banner.js';
import {
  RoutingGraph,
  type RoutingSourceGroup,
  type RoutingTarget,
} from '../components/settings/routing-graph.js';
import { SettingsDangerZone } from '../components/settings-list.js';
import { PhoneTabBar } from '../components/shell/phone-tab-bar.js';
import { ArchivedProjectCard, ProjectCard } from '../components/shell/project-card.js';
import { SidebarNavRow } from '../components/shell/sidebar-nav-row.js';
import {
  SidebarProjectGroupHeader,
  SidebarProjectRow,
} from '../components/shell/sidebar-project.js';
import { Button } from '../components/ui/button.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { Greeting } from './prototypes/greeting.js';
import { Section, Specimen } from './specimen.js';

export function SidebarSection() {
  const [active, setActive] = useState('cairn');
  const [sideOpen, setSideOpen] = useState(true);
  return (
    <Section
      id="sidebar"
      title="Sidebar parts"
      lede="The sidebar shares the main surface: the Coordinator row, its projects hung under it with a tree guide, owner-made groups that fold to a count, and an ochre dot when a task waits on the owner."
    >
      <Specimen
        id="sidebar"
        title="Sidebar"
        note="Click a project"
        stage="canvas"
        code={`<SidebarNavRow icon={<BrandGlyph />} label="Coordinator" active />\n<SidebarProjectRow name="cairn" place="first" waiting="A task is waiting on you" />\n<SidebarProjectGroupHeader name="Side projects" count={1} expanded onToggle={toggle} spaced />\n<SidebarProjectRow name="site" place="only" />`}
      >
        <div className="flex w-55 flex-col gap-0.5 px-2 py-1">
          <SidebarNavRow
            icon={<BrandGlyph className="size-5" />}
            label="Coordinator"
            active={active === 'coordinator'}
            onClick={() => setActive('coordinator')}
          />
          <SidebarProjectRow
            name="cairn"
            icon="mountain"
            place="first"
            waiting="A task is waiting on you"
            status="Needs you · Approve the plan"
            active={active === 'cairn'}
            onClick={() => setActive('cairn')}
          />
          <SidebarProjectRow
            name="api-latency"
            place="last"
            active={active === 'api'}
            onClick={() => setActive('api')}
          />
          <SidebarProjectGroupHeader
            name="Side projects"
            count={1}
            spaced
            expanded={sideOpen}
            onToggle={() => setSideOpen((open) => !open)}
          />
          {sideOpen && (
            <SidebarProjectRow
              name="site"
              place="only"
              active={active === 'site'}
              onClick={() => setActive('site')}
            />
          )}
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
      lede="The Projects page card, the shared list row used by Library and settings lists, and the phone tab bar with an inbox badge."
    >
      <Specimen
        id="project-cards"
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
        id="list-rows"
        title="List rows"
        stage="canvas"
        code={`<ListCard>\n  <ListRow icon={<FileText />} title="plan-b2.md" subtitle="Coordinator · 12 KB" trailing="2h ago" />\n</ListCard>`}
      >
        <ListCard className="w-full max-w-130">
          <ListRow
            icon={<Inbox className="size-5" />}
            title="batch-b2-plan.md"
            subtitle="Coordinator · 12 KB"
            trailing="2h ago"
          />
          <ListRow
            icon={<FolderGit2 className="size-5" />}
            title="screenshots"
            subtitle="Thread 2235 · 6 files"
            trailing="Yesterday"
          />
          <ListRow
            icon={<CalendarClock className="size-5" />}
            title="weekly-report.md"
            subtitle="Scheduled task · 3 KB"
            trailing="Oct 27"
          />
        </ListCard>
      </Specimen>
      <Specimen
        id="phone-tab-bar"
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
                icon: <BrandGlyph className="size-5" />,
              },
              { id: 'projects', label: 'Projects', icon: <LayoutGrid className="size-5.5" /> },
            ]}
          />
        </div>
      </Specimen>
      <Specimen
        id="settings-danger-zone"
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
  return (
    <Section
      id="coordinator"
      title="Coordinator stream parts"
      lede="The pieces around the thread cards: the greeting and the archived banner that replaces the composer."
    >
      <Specimen
        id="stream-header"
        title="Stream header"
        note="The greeting line that opens the Coordinator home"
        code={`<Greeting since="Since last night">Morning, ian.</Greeting>`}
      >
        <div className="flex w-full max-w-170 flex-col gap-3.5">
          <Greeting since="Since last night">Morning, ian.</Greeting>
        </div>
      </Specimen>
      <Specimen
        id="archived-banner"
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

const ROUTING_GROUPS: RoutingSourceGroup[] = [
  {
    label: 'Coordinator and other agents',
    nodes: [
      { id: 'coordinator', name: 'Coordinator', tag: 'Claude Opus 5.5', target: 'claude' },
      { id: 'session', name: 'New tasks', tag: 'GPT-6.1 Sol', target: 'codex' },
      { id: 'review', name: 'Review', tag: 'Claude Sonnet 5.5', target: 'claude' },
    ],
  },
  {
    label: 'Claude Code',
    nodes: [{ id: 'claude-models', name: 'All Claude models', target: 'claude' }],
  },
];

const ROUTING_TARGETS: RoutingTarget[] = [
  { id: 'claude', name: 'Claude subscription', runtime: 'Claude Code' },
  { id: 'codex', name: 'ChatGPT', runtime: 'pi' },
  { id: 'proxy', name: 'domestic-proxy', runtime: 'pi', unavailable: true },
];

export function RoutingSection() {
  return (
    <Section
      id="routing"
      title="Model routing parts"
      lede="Each use on the left names its model; a curve runs to the provider that serves it. Hovering a node lights its wires. A rule whose provider is unavailable is a dashed rust wire."
    >
      <Specimen
        id="routing-nodes"
        title="Routing graph"
        stage="canvas"
        code={`<RoutingGraph groups={[{ label: 'Agents', nodes: [{ id: 'coordinator', name: 'Coordinator', tag: 'Claude Opus 5.5', target: 'claude' }] }]} targets={[{ id: 'claude', name: 'Claude subscription', runtime: 'Claude Code' }]} />`}
      >
        <div className="flex w-full max-w-170 flex-col gap-4">
          <RoutingGraph groups={ROUTING_GROUPS} targets={ROUTING_TARGETS} />
        </div>
      </Specimen>
    </Section>
  );
}
