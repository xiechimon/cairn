import type { ProjectColor, ProjectIcon } from '@cairn/shared';
import {
  BookText,
  Brain,
  Gauge,
  KeyRound,
  Layers,
  ListTodo,
  MessageSquare,
  Settings2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { EmptyState } from '../components/empty-state.js';
import { ListCard, ListRow } from '../components/list-card.js';
import { StatStrip } from '../components/stat-strip.js';
import { StoneGroup, StoneTrail } from '../components/stone/stone-group.js';
import { Greeting } from '../components/stream/greeting.js';
import { ScheduledTaskRow } from '../components/thread/scheduled-task-row.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import { Button } from '../components/ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import type { ScheduleRecord, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { scheduleSummary } from '../pages/schedule-summary.js';
import { SECRETS_HREF } from '../resources/secrets-page.js';
import { ScheduleDetailController } from '../schedules/schedule-detail-dialog.js';
import {
  ARCHIVED_PROJECT_WRITE_REASON,
  ArchivedProjectBar,
  type ArchivedProjectState,
} from './archived-project-bar.js';
import { needsYouThreads } from './needs-you.js';
import { ProjectAvatar } from './project-avatar.js';
import { relativeTime } from './rel-time.js';
import { threadCopy, threadStatus, threadTone } from './thread-copy.js';
import { useThreadHref } from './thread-link.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProjectHomeProject {
  id: string;
  name: string;
  description?: string | undefined;
  instructions?: string | undefined;
  repo?: string | undefined;
  baseBranch?: string | null | undefined;
  icon?: ProjectIcon | null | undefined;
  color?: ProjectColor | null | undefined;
}

function CardHead({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3.5 pt-3 pb-1.5">
      <span aria-hidden="true" className="text-content-tertiary">
        {icon}
      </span>
      <h3 className="m-0 mr-auto text-meta font-medium text-foreground">{title}</h3>
      {action}
    </div>
  );
}

function CardNote({ children }: { children: ReactNode }) {
  return <p className="m-0 px-3.5 pb-3 text-meta text-content-tertiary">{children}</p>;
}

export function ProjectHome({
  project,
  todos,
  schedules,
  now,
  chatHref,
  archived = null,
}: {
  project: ProjectHomeProject;
  todos: readonly TodoRecord[];
  schedules: readonly ScheduleRecord[];
  now: number;
  chatHref: string;
  archived?: ArchivedProjectState | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const threadHref = useThreadHref();
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleRecord | null>(null);
  const own = todos.filter((todo) => todo.projectId === project.id && todo.archivedAt == null);
  const needsYou = needsYouThreads(own);
  const running = own.filter((todo) => threadStatus(todo) === 'running');
  const idle = own.filter((todo) => threadStatus(todo) === 'idle');
  const done = own
    .filter((todo) => threadStatus(todo) === 'done')
    .sort((a, b) => b.phaseAt - a.phaseAt);
  const mergedThisWeek = done.filter(
    (todo) => todo.phase === 'done' && now - todo.phaseAt <= WEEK_MS,
  ).length;
  const ownSchedules = schedules.filter((schedule) => schedule.projectId === project.id);
  const facts = [project.repo, project.baseBranch].filter(
    (fact): fact is string => fact != null && fact !== '',
  );
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
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <section
        data-testid="project-home"
        aria-label={project.name}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <header className="flex h-12 flex-none items-center gap-0.5 pr-3 pl-5 max-[640px]:pl-14">
          <h1 className="m-0 mr-auto min-w-0 truncate text-ui font-semibold text-foreground">
            {project.name}
          </h1>
          <nav data-testid="project-home-links" aria-label={t('项目')} className="flex gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="text-meta text-content-secondary"
              render={<Link to={`/app/project/${project.id}/tasks`} />}
            >
              <ListTodo aria-hidden="true" className="size-4" />
              {t('任务')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-meta text-content-secondary"
              render={<Link to={`/app/project/${project.id}/settings`} />}
            >
              <Settings2 aria-hidden="true" className="size-4" />
              {t('项目设置')}
            </Button>
          </nav>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-[calc(100%-2rem)] max-w-240 pt-[4vh] pb-12">
            <div className="flex items-center gap-3">
              <ProjectAvatar
                name={project.name}
                tone={0}
                icon={project.icon}
                color={project.color}
                className="size-9 rounded-lg text-ui"
              />
              <div className="min-w-0">
                <Greeting as="h2">{project.name}</Greeting>
                {facts.length > 0 && (
                  <p className="m-0 mt-0.5 truncate text-meta text-content-tertiary">
                    {facts.join(' · ')}
                  </p>
                )}
              </div>
            </div>
            {project.description != null && project.description !== '' && (
              <p className="m-0 mt-3 max-w-160 text-ui text-content-secondary">
                {project.description}
              </p>
            )}
            <StatStrip
              className="mt-5 max-w-160"
              items={[
                { value: String(needsYou.length), label: t('等你处理') },
                { value: String(running.length), label: t('在进行') },
                { value: String(mergedThisWeek), label: t('本周合并') },
              ]}
            />
            {archived === null ? (
              <Button
                variant="outline"
                data-testid="project-home-ask"
                className="mt-5 h-11 w-full max-w-160 justify-start gap-2 rounded-xl bg-card text-ui font-normal text-content-secondary shadow-(--e1)"
                render={<Link to={chatHref} />}
              >
                <MessageSquare aria-hidden="true" className="size-5" />
                {t('问 Coordinator 关于 {name} 的事…', { name: project.name })}
              </Button>
            ) : (
              <ArchivedProjectBar state={archived} className="mt-5 w-full max-w-160" />
            )}
            <div className="mt-8 grid grid-cols-[minmax(0,1fr)_20rem] gap-6 max-[960px]:grid-cols-1">
              <section aria-label="Threads">
                {own.length === 0 ? (
                  <EmptyState
                    testId="project-home-empty"
                    icon={ListTodo}
                    title={t('这个项目还没有 thread')}
                    description={t('在上面问 Coordinator，它会开 thread 来做。')}
                    className="mt-[6vh]"
                  />
                ) : (
                  <StoneTrail className="px-0">
                    <StoneGroup
                      tone="waiting"
                      label={t('等你处理')}
                      count={needsYou.length}
                      emptyHint={t('没有等你的事')}
                    >
                      {needsYou.map((todo) => row(todo))}
                    </StoneGroup>
                    <StoneGroup
                      tone="working"
                      label={t('在进行')}
                      count={running.length}
                      emptyHint={t('没有在进行的任务')}
                    >
                      {running.map((todo) => row(todo, 'working'))}
                    </StoneGroup>
                    <StoneGroup
                      tone="idle"
                      label={t('接下来')}
                      count={idle.length}
                      emptyHint={t('没有空闲的任务')}
                    >
                      {idle.map((todo) => row(todo, 'idle'))}
                    </StoneGroup>
                    {done.length > 0 && (
                      <StoneGroup tone="resolved" label={t('已完成')} count={done.length}>
                        {done.slice(0, 5).map((todo) => row(todo, 'resolved'))}
                      </StoneGroup>
                    )}
                  </StoneTrail>
                )}
              </section>
              <aside className="flex flex-col gap-4">
                <ListCard>
                  <CardHead
                    icon={<BookText className="size-4" />}
                    title={t('项目说明')}
                    action={
                      archived === null ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-meta text-content-secondary"
                          render={<Link to={`/app/project/${project.id}/settings`} />}
                        >
                          {t('编辑')}
                        </Button>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="xs"
                                data-testid="project-home-edit-blocked"
                                aria-disabled
                                aria-description={t(ARCHIVED_PROJECT_WRITE_REASON)}
                                className="cursor-not-allowed text-meta text-content-tertiary hover:bg-transparent"
                              />
                            }
                          >
                            {t('编辑')}
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={6}>
                            {t(ARCHIVED_PROJECT_WRITE_REASON)}
                          </TooltipContent>
                        </Tooltip>
                      )
                    }
                  />
                  {project.instructions != null && project.instructions !== '' ? (
                    <p
                      data-testid="project-home-instructions"
                      className="m-0 line-clamp-6 px-3.5 pb-3 text-meta whitespace-pre-line text-content-secondary"
                    >
                      {project.instructions}
                    </p>
                  ) : (
                    <CardNote>
                      {t(
                        '还没有项目说明。写在这里的规则会被本项目的每个 thread 和 Coordinator 读到。',
                      )}
                    </CardNote>
                  )}
                </ListCard>
                <ListCard>
                  <CardHead icon={<Brain className="size-4" />} title={t('项目记忆')} />
                  <CardNote>
                    {t('Coordinator 在本项目学到的事会记在这里，默认只在本项目内使用。即将上线。')}
                  </CardNote>
                </ListCard>
                <ListCard>
                  <CardHead icon={<Layers className="size-4" />} title={t('定时任务')} />
                  {ownSchedules.length === 0 ? (
                    <CardNote>{t('没有定时任务')}</CardNote>
                  ) : (
                    <div className="px-1.5 pb-1.5">
                      {ownSchedules.map((schedule) => (
                        <ScheduledTaskRow
                          key={schedule.id}
                          name={schedule.todo.title}
                          trigger={
                            schedule.enabled === false
                              ? (schedule.pausedReason ?? t('已暂停'))
                              : scheduleSummary(schedule, now, t)
                          }
                          state={
                            schedule.enabled === false
                              ? schedule.pausedReason == null
                                ? 'paused'
                                : 'disabled'
                              : 'active'
                          }
                          onOpen={() => setSelectedSchedule(schedule)}
                        />
                      ))}
                    </div>
                  )}
                </ListCard>
                <ListCard>
                  <Link to={SECRETS_HREF} className="text-inherit no-underline">
                    <ListRow
                      icon={<KeyRound className="size-5" />}
                      title={t('密钥')}
                      subtitle={t('目前用团队密钥')}
                    />
                  </Link>
                  <Link
                    to={`/app/project/${project.id}/settings`}
                    className="text-inherit no-underline"
                  >
                    <ListRow
                      icon={<Gauge className="size-5" />}
                      title={t('并发与优先级')}
                      subtitle={t('目前跟随机器上限')}
                    />
                  </Link>
                </ListCard>
              </aside>
            </div>
          </div>
        </div>
      </section>
      <ScheduleDetailController
        schedule={selectedSchedule}
        now={now}
        onClose={() => setSelectedSchedule(null)}
      />
    </div>
  );
}
