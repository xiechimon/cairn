import type { SearchResponse } from '@cairn/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useProjects } from '../api/hooks.js';
import { useAgentAvatarUrlById, useLiveData } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_FACE,
  DialogShell,
  PICKER_ROW_SELECTED,
  VIEWPORT_POP_ANIM,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { StatusChip } from '../components/ui/status-chip.js';
import { PROJECT_ID, PROJECT_INITIAL, PROJECT_NAME } from '../fixtures/fixtures.js';
import type { AgentRef, FixtureSet, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  Clock,
  FileCheck,
  Kanban,
  Key,
  Layers,
  Network,
  Puzzle,
  Search,
  Server,
  Users,
} from '../icons/index.js';
import { PHASE_UI } from '../phase.js';

const NAV_ROWS = [
  { label: '任务', Icon: FileCheck, href: '/app' },
  { label: '工作台', Icon: Kanban, href: '/app' },
  { label: '定时', Icon: Clock, href: '/app/schedules' },
  { label: '团队', Icon: Users, href: '/app/team' },
  { label: '技能', Icon: Puzzle, href: '/app/resources/skills' },
  { label: 'MCP', Icon: Network, href: '/app/resources/mcp-servers' },
  { label: '密钥', Icon: Key, href: '/app/resources/secrets' },
  { label: '机器', Icon: Server, href: '/app/resources/machines' },
  { label: '模型服务', Icon: Layers, href: '/app/resources/providers' },
];

const ROW_BASE =
  'flex h-10 w-full cursor-pointer items-center justify-start gap-4 whitespace-normal rounded-md border-none bg-transparent pl-4 pr-2 text-left text-ui font-normal text-content-secondary hover:text-content-secondary active:not-aria-[haspopup]:translate-y-0 [&>svg]:flex-none [&>svg]:text-content-tertiary';

const ROW_RESULT = 'gap-3 pl-2';

function rowLitClasses(selected: boolean, kbd: boolean): string {
  if (selected) return PICKER_ROW_SELECTED;
  if (kbd) return 'hover:bg-transparent dark:hover:bg-transparent';
  return 'hover:bg-card hover:shadow-xs hover:ring-1 hover:ring-border dark:hover:bg-card';
}

const ROW_ICON =
  'flex size-7 flex-none items-center justify-center rounded-md bg-(--row-icon-bg) text-content-tertiary';

interface SearchPanelProps {
  fixture: FixtureSet;
  query: string;
  onQuery: (query: string) => void;
  open: boolean;
  onClose: () => void;
  server?: SearchResponse;
}

interface TodoRowItem {
  id: string;
  seqNum: number;
  title: string;
  phase: TodoRecord['phase'];
  phaseAt: number;
  projectId?: string;
  projectName?: string;
}
interface AgentRowItem {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}
interface ProjectRowItem {
  id: string;
  name: string;
}

function TodoRow({
  todo,
  now,
  selected,
  kbd,
  index,
  onActivate,
  projectName,
}: {
  todo: TodoRowItem;
  now: number;
  selected: boolean;
  kbd: boolean;
  index: number;
  onActivate: () => void;
  projectName?: string;
}) {
  const { t } = useI18n();
  const ui = PHASE_UI[todo.phase];
  return (
    <Button
      variant="ghost"
      data-row-kind="todo"
      data-row-index={index}
      data-selected={selected ? '' : undefined}
      onClick={onActivate}
      className={`${ROW_BASE} ${ROW_RESULT} ${rowLitClasses(selected, kbd)}`}
    >
      <span className={ROW_ICON}>
        <FileCheck width={16} height={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate leading-5 text-foreground">
          #{todo.seqNum} {todo.title}
        </span>
        {projectName !== undefined && (
          <span className="truncate text-meta text-content-tertiary">{projectName}</span>
        )}
      </span>
      <span className="flex-none text-meta text-content-tertiary">
        {relativeTime(todo.phaseAt, now, t)}
      </span>
      <StatusChip tone={ui.tone} className="ml-auto flex-none">
        {t(ui.chip)}
      </StatusChip>
    </Button>
  );
}

let openPanelCount = 0;
function useSingleLitSurface(open: boolean) {
  useEffect(() => {
    if (!open) return;
    openPanelCount += 1;
    document.documentElement.dataset.searchOpen = '';
    return () => {
      openPanelCount -= 1;
      if (openPanelCount === 0) delete document.documentElement.dataset.searchOpen;
    };
  }, [open]);
}

export function SearchPanel({ fixture, query, onQuery, open, onClose, server }: SearchPanelProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { search } = useLocation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const [cursor, setCursor] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);
  const attachInput = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (node && openRef.current) node.focus({ preventScroll: true });
  }, []);
  useSingleLitSurface(open);
  const q = query.trim().toLowerCase();
  const useServer = server !== undefined && q !== '';
  const todos: TodoRowItem[] = useServer
    ? server.todos
    : q === ''
      ? []
      : fixture.todos.filter((t) => t.title.toLowerCase().includes(q));
  const agentAvatarById = useAgentAvatarUrlById();
  const agents: AgentRowItem[] = useServer
    ? server.agents.map((a) => ({ ...a, avatarUrl: agentAvatarById.get(a.id) ?? null }))
    : q === ''
      ? []
      : [...new Set(fixture.todos.map((t) => t.agent))]
          .filter((agent): agent is AgentRef => agent != null)
          .filter((agent) => agent.displayName.toLowerCase().includes(q));
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const liveProjects = live ? (projectsQ.data ?? []) : undefined;
  const projectName = fixture.projectNames
    ? (Object.values(fixture.projectNames)[0] ?? PROJECT_NAME)
    : PROJECT_NAME;
  const clientProjectName = (projectId: string | undefined): string | undefined =>
    liveProjects
      ? liveProjects.find((project) => project.id === projectId)?.name
      : ((projectId !== undefined ? fixture.projectNames?.[projectId] : undefined) ?? projectName);
  const projects: ProjectRowItem[] = useServer
    ? server.projects
    : q === ''
      ? []
      : liveProjects
        ? liveProjects
            .filter((project) => project.name.toLowerCase().includes(q))
            .map(({ id, name }) => ({ id, name }))
        : projectName.toLowerCase().includes(q)
          ? [
              {
                id: fixture.projectNames
                  ? (Object.keys(fixture.projectNames)[0] ?? PROJECT_ID)
                  : PROJECT_ID,
                name: projectName,
              },
            ]
          : [];
  const hitCount = todos.length + agents.length + projects.length;

  const targets =
    q === ''
      ? NAV_ROWS.map((row) => row.href)
      : [
          ...todos.map((todo) => `/app/todo/${todo.id}`),
          ...projects.map((project) => `/app/project/${project.id}`),
          ...agents.map(() => '/app/team'),
        ];

  const go = (pathname: string) => {
    navigate({ pathname, search });
    onClose();
  };
  const releaseCursor = () => setCursor(null);

  useEffect(() => {
    setCursor(null);
  }, [query, open]);

  useEffect(() => {
    if (cursor == null) return;
    listRef.current
      ?.querySelector(`[data-row-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const kbd = cursor != null;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      viewportRoot
      backdropClassName="z-(--z-modal-scrim) duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      zIndex="var(--z-modal)"
    >
      <div
        className={`search-panel fixed top-36.5 left-1/2 z-(--z-modal) flex h-110 w-130 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-hidden ${DIALOG_FACE} origin-top transition-[opacity,scale] group-data-closed/dlgvp:scale-[0.98] group-data-closed/dlgvp:opacity-0 motion-reduce:transition-none ${VIEWPORT_POP_ANIM}`}
        role="dialog"
        aria-label={t('搜索')}
        onMouseEnter={releaseCursor}
        onMouseMove={(event) => {
          const prev = pointerRef.current;
          pointerRef.current = { x: event.clientX, y: event.clientY };
          if (prev != null && (prev.x !== event.clientX || prev.y !== event.clientY))
            setCursor(null);
        }}
      >
        <div className="flex h-10 flex-none items-center gap-2 border-b border-border px-4 text-content-tertiary">
          <Search width={14} height={14} />
          <Input
            ref={attachInput}
            className="flex-1 h-auto border-none shadow-none ring-0 p-0 text-ui md:text-ui leading-4 rounded-none bg-transparent dark:bg-transparent text-foreground placeholder:text-content-tertiary focus-visible:border-transparent focus-visible:!ring-0 focus-visible:outline-none"
            value={query}
            placeholder={t('搜索任务、项目、成员…')}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (targets.length === 0) return;
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setCursor((prev) =>
                  prev == null
                    ? event.key === 'ArrowDown'
                      ? 0
                      : targets.length - 1
                    : (prev + step + targets.length) % targets.length,
                );
              } else if (event.key === 'Enter' && cursor != null) {
                const target = targets[cursor];
                if (target == null) return;
                event.preventDefault();
                go(target);
              }
            }}
          />
        </div>
        {q === '' ? (
          <div className="flex-1 overflow-y-auto px-2 pb-2" ref={listRef}>
            <div className="px-2 pt-3 pb-1 text-caption text-content-tertiary">{t('前往')}</div>
            {NAV_ROWS.map(({ label, Icon, href }, index) => (
              <Button
                variant="ghost"
                key={label}
                data-row-kind="nav"
                data-row-index={index}
                data-selected={cursor === index ? '' : undefined}
                className={`${ROW_BASE} ${rowLitClasses(cursor === index, kbd)}`}
                onClick={() => go(href)}
              >
                <Icon width={16} height={16} />
                {t(label)}
              </Button>
            ))}
          </div>
        ) : hitCount === 0 ? (
          <div className="px-4 py-6 text-ui text-content-tertiary">
            {t('没有与“{q}”匹配的结果', { q: query.trim() })}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-2 pb-2" ref={listRef}>
            {todos.length > 0 && (
              <>
                <div className="px-2 pt-3 pb-1 text-caption text-content-tertiary">{t('任务')}</div>
                {todos.map((todo, index) => (
                  <TodoRow
                    key={todo.id}
                    todo={todo}
                    now={fixture.now}
                    selected={cursor === index}
                    kbd={kbd}
                    index={index}
                    onActivate={() => go(`/app/todo/${todo.id}`)}
                    projectName={useServer ? todo.projectName : clientProjectName(todo.projectId)}
                  />
                ))}
              </>
            )}
            {projects.length > 0 && (
              <>
                <div className="px-2 pt-3 pb-1 text-caption text-content-tertiary">{t('项目')}</div>
                {projects.map((project, index) => (
                  <Button
                    variant="ghost"
                    key={project.id}
                    data-row-kind="project"
                    data-row-index={todos.length + index}
                    data-selected={cursor === todos.length + index ? '' : undefined}
                    className={`${ROW_BASE} ${ROW_RESULT} ${rowLitClasses(
                      cursor === todos.length + index,
                      kbd,
                    )}`}
                    onClick={() => go(`/app/project/${project.id}`)}
                  >
                    <span
                      className={`${ROW_ICON} bg-(--project-avatar-bg) text-caption font-medium text-(--project-avatar-fg)`}
                    >
                      {project.name.charAt(0).toLowerCase() || PROJECT_INITIAL}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-foreground">{project.name}</span>
                    </span>
                  </Button>
                ))}
              </>
            )}
            {agents.length > 0 && (
              <>
                <div className="px-2 pt-3 pb-1 text-caption text-content-tertiary uppercase">
                  Agents
                </div>
                {agents.map((agent, index) => {
                  const rowIndex = todos.length + projects.length + index;
                  return (
                    <Button
                      variant="ghost"
                      key={agent.id}
                      data-row-kind="agent"
                      data-row-index={rowIndex}
                      data-selected={cursor === rowIndex ? '' : undefined}
                      className={`${ROW_BASE} ${ROW_RESULT} ${rowLitClasses(cursor === rowIndex, kbd)}`}
                      onClick={() => go('/app/team')}
                    >
                      <span
                        className={`${ROW_ICON} bg-transparent [&_img]:size-4 [&_img]:rounded-full`}
                      >
                        <SeededAvatar
                          className="size-4"
                          name={agent.displayName}
                          src={agent.avatarUrl}
                          fallback="/avatar-robot-1.svg"
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-foreground">{agent.displayName}</span>
                      </span>
                    </Button>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </DialogShell>
  );
}

export function useSearchState(initialOpen: boolean, initialQuery: string) {
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState(initialQuery);
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen, query, setQuery };
}
