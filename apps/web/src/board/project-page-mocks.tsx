import { ArrowUp, BookText, Brain, FolderOpen, KeyRound, Layers, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { ListCard, ListRow } from '../components/list-card.js';
import { StatStrip } from '../components/stat-strip.js';
import { StoneGroup, StoneTrail } from '../components/stone/stone-group.js';
import { Greeting } from '../components/stream/greeting.js';
import { ScheduledTaskRow } from '../components/thread/scheduled-task-row.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import { Button } from '../components/ui/button.js';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { needsYouThreads } from './needs-you.js';
import { ProjectAvatar } from './project-avatar.js';
import { relativeTime } from './rel-time.js';
import { threadCopy, threadHref, threadStatus, threadTone } from './thread-copy.js';

export type ProjectPageMock = 'home' | 'hybrid';

export function projectPageMockOf(value: string | null): ProjectPageMock | null {
  return value === 'home' || value === 'hybrid' ? value : null;
}

const PROJECT_FACTS = {
  repo: 'xiechimon/cairn',
  branch: 'main',
  goal: 'Self-hostable agent team: one Coordinator, threads on your own machines, a merge gate that checks every patch.',
  instructions:
    'Repository content is English. Run pnpm lint, typecheck and spec:parse after code changes. Owner-route PRs go to ian; never force push. Prefer small PRs with failing tests first.',
  memories: [
    { title: 'Mergify queue needs the review-gate label', source: 'Learned in #2510', age: '2d' },
    { title: 'omarchy is reinstalled; deploy target is the Mac', source: 'ian, Nov 2', age: '1d' },
    { title: 'Drizzle migrations renumber after D71 lands', source: 'Thread #2672', age: '4h' },
  ],
  schedules: [
    { name: 'Nightly e2e sweep', trigger: 'Daily at 02:00', next: 'Tue 02:00' },
    { name: 'Dependency bump', trigger: 'Weekly · Mon 09:00', next: 'Mon 09:00' },
  ],
  secrets: 3,
  concurrency: 'Parallel · up to 3',
};

function useThreadGroups(todos: readonly TodoRecord[]) {
  const live = todos.filter((todo) => todo.archivedAt == null);
  const needsYou = needsYouThreads(live);
  const running = live.filter((todo) => threadStatus(todo) === 'running');
  const idle = live.filter((todo) => threadStatus(todo) === 'idle');
  const done = live.filter((todo) => threadStatus(todo) === 'done');
  return { needsYou, running, idle, done };
}

function ProjectTitle({ name, since }: { name: string; since: string }) {
  return (
    <div className="flex items-center gap-3">
      <ProjectAvatar name={name} tone={0} className="size-9 rounded-lg text-ui" />
      <div className="min-w-0">
        <Greeting as="h2">{name}</Greeting>
        <p className="m-0 mt-0.5 text-meta text-content-tertiary">{since}</p>
      </div>
    </div>
  );
}

function AskBar({ name, onAsk }: { name: string; onAsk: () => void }) {
  return (
    <InputGroup className="h-11 rounded-xl bg-card shadow-(--e1)">
      <InputGroupInput
        readOnly
        onFocus={onAsk}
        placeholder={`Ask the Coordinator about ${name}…`}
        className="text-ui"
      />
      <InputGroupAddon align="inline-end">
        <Button size="icon-sm" variant="ghost" aria-label="Ask" onClick={onAsk}>
          <ArrowUp aria-hidden="true" />
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}

function CardHead({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-3.5 pt-3 pb-1.5">
      <span className="text-content-tertiary">{icon}</span>
      <h3 className="m-0 mr-auto text-meta font-medium text-content-secondary">{title}</h3>
      {action}
    </div>
  );
}

export function ProjectHomeMock({
  projectId,
  projectName,
  todos,
  now,
}: {
  projectId: string;
  projectName: string;
  todos: readonly TodoRecord[];
  now: number;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const scoped = todos.filter((todo) => todo.projectId === projectId);
  const { needsYou, running, idle, done } = useThreadGroups(scoped);
  const ask = () => navigate(`/app?scenario=home-c&project=${projectId}`);
  const row = (todo: TodoRecord, tone = threadTone(todo)) => (
    <ThreadRow
      key={todo.id}
      title={todo.title}
      tone={tone}
      reason={t(threadCopy(todo).reason)}
      age={relativeTime(todo.phaseAt, now, t)}
      onOpen={() => navigate(threadHref(todo.id))}
    />
  );
  return (
    <section
      data-testid="project-home-mock"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="flex h-12 flex-none items-center gap-0.5 pr-3 pl-5 max-[640px]:pl-14">
        <h1 className="m-0 mr-auto min-w-0 truncate text-ui font-semibold text-foreground">
          {projectName}
        </h1>
        <Button variant="ghost" size="sm" className="text-meta text-content-secondary">
          <FolderOpen aria-hidden="true" className="size-3.5" />
          Files
        </Button>
        <Button variant="ghost" size="sm" className="text-meta text-content-secondary">
          <Settings2 aria-hidden="true" className="size-3.5" />
          Settings
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-[calc(100%-2rem)] max-w-240 pt-[4vh] pb-12">
          <ProjectTitle
            name={projectName}
            since={`${PROJECT_FACTS.repo} · ${PROJECT_FACTS.branch} · ${PROJECT_FACTS.concurrency}`}
          />
          <p className="m-0 mt-3 max-w-160 text-ui text-content-secondary">{PROJECT_FACTS.goal}</p>
          <StatStrip
            className="mt-5 max-w-160"
            items={[
              { value: String(needsYou.length), label: 'Waiting on you' },
              { value: String(running.length), label: 'In progress' },
              { value: String(done.length), label: 'Merged this week' },
            ]}
          />
          <div className="mt-5 max-w-160">
            <AskBar name={projectName} onAsk={ask} />
          </div>
          <div className="mt-8 grid grid-cols-[minmax(0,1fr)_20rem] gap-6 max-[960px]:grid-cols-1">
            <section aria-label="Threads">
              <h3 className="m-0 mb-1 px-2 text-meta font-medium text-content-secondary">
                Threads
              </h3>
              <StoneTrail className="px-0">
                <StoneGroup tone="waiting" label="Waiting on you" count={needsYou.length}>
                  {needsYou.map((todo) => row(todo))}
                </StoneGroup>
                <StoneGroup tone="working" label="In progress" count={running.length}>
                  {running.map((todo) => row(todo, 'working'))}
                </StoneGroup>
                <StoneGroup tone="idle" label="Up next" count={idle.length}>
                  {idle.map((todo) => row(todo, 'idle'))}
                </StoneGroup>
                <StoneGroup tone="resolved" label="Done" count={done.length} collapsed>
                  {done.map((todo) => row(todo, 'resolved'))}
                </StoneGroup>
              </StoneTrail>
            </section>
            <aside className="flex flex-col gap-4">
              <ListCard>
                <CardHead
                  icon={<BookText className="size-3.5" />}
                  title="Instructions"
                  action={
                    <Button variant="ghost" size="xs" className="text-meta">
                      Edit
                    </Button>
                  }
                />
                <p className="m-0 line-clamp-4 px-3.5 pb-3 text-meta text-content-secondary">
                  {PROJECT_FACTS.instructions}
                </p>
              </ListCard>
              <ListCard>
                <CardHead
                  icon={<Brain className="size-3.5" />}
                  title="Memory · this project only"
                />
                {PROJECT_FACTS.memories.map((memory) => (
                  <div
                    key={memory.title}
                    className="group/memory flex items-start gap-2 px-3.5 py-2.5 hover:bg-sidebar-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-meta text-foreground">{memory.title}</p>
                      <small className="block text-caption text-content-tertiary">
                        {memory.source} · {memory.age}
                      </small>
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="hidden text-caption text-content-tertiary group-hover/memory:inline-flex"
                    >
                      Make team-wide
                    </Button>
                  </div>
                ))}
              </ListCard>
              <ListCard>
                <CardHead icon={<Layers className="size-3.5" />} title="Schedules" />
                <div className="px-1.5 pb-1.5">
                  {PROJECT_FACTS.schedules.map((schedule) => (
                    <ScheduledTaskRow
                      key={schedule.name}
                      name={schedule.name}
                      trigger={schedule.trigger}
                      next={schedule.next}
                      state="active"
                    />
                  ))}
                </div>
              </ListCard>
              <ListCard>
                <ListRow
                  icon={<KeyRound className="size-4" />}
                  title="Secrets"
                  subtitle={`${PROJECT_FACTS.secrets} for this project, plus team secrets`}
                />
                <ListRow
                  icon={<Settings2 className="size-4" />}
                  title="Project settings"
                  subtitle="Base branch, merge route, concurrency"
                />
              </ListCard>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ProjectHybridHeader({
  projectId,
  projectName,
  todos,
  now,
}: {
  projectId: string;
  projectName: string;
  todos: readonly TodoRecord[];
  now: number;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const scoped = todos.filter((todo) => todo.projectId === projectId);
  const { needsYou, running, idle } = useThreadGroups(scoped);
  const strip = [...running, ...idle];
  return (
    <div data-testid="project-hybrid-header">
      <ProjectTitle name={projectName} since={`${PROJECT_FACTS.repo} · ${PROJECT_FACTS.branch}`} />
      <p className="m-0 mt-3 text-ui text-content-secondary max-[640px]:hidden">
        {PROJECT_FACTS.goal}
      </p>
      <div className="mt-2 -ml-2.5 flex gap-1 overflow-x-auto whitespace-nowrap">
        <Button variant="ghost" size="sm" className="text-meta text-content-secondary">
          <BookText aria-hidden="true" className="size-3.5" />
          Instructions
        </Button>
        <Button variant="ghost" size="sm" className="text-meta text-content-secondary">
          <Brain aria-hidden="true" className="size-3.5" />
          Memory · {PROJECT_FACTS.memories.length}
        </Button>
        <Button variant="ghost" size="sm" className="text-meta text-content-secondary">
          <Layers aria-hidden="true" className="size-3.5" />
          Schedules · {PROJECT_FACTS.schedules.length}
        </Button>
        <Button variant="ghost" size="sm" className="text-meta text-content-secondary">
          <KeyRound aria-hidden="true" className="size-3.5" />
          Secrets · {PROJECT_FACTS.secrets}
        </Button>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <h3 className="m-0 text-meta font-medium text-content-secondary">
          In progress and up next
        </h3>
        <span className="text-caption text-content-tertiary">
          {needsYou.length} waiting · {running.length} in progress · {idle.length} up next
        </span>
      </div>
      <div className="mt-2 -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {strip.map((todo) => (
          <div
            key={todo.id}
            className="w-64 flex-none rounded-(--radius-card) bg-card shadow-(--e1)"
          >
            <ThreadRow
              title={todo.title}
              tone={threadTone(todo)}
              reason={t(threadCopy(todo).reason)}
              age={relativeTime(todo.phaseAt, now, t)}
              onOpen={() => navigate(threadHref(todo.id))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
