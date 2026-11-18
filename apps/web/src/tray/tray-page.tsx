import type { DesktopRunnerState, DesktopTrayOpen, DesktopTrayState } from '@cairn/shared';
import { cn } from 'cn';
import { Coffee, Monitor, Search, Settings, SquarePen } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTasks } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { isWaiting, tasksFromQuery } from '../board/tasks-sections.js';
import { threadHref } from '../board/thread-copy.js';
import { BrandGlyph } from '../components/brand-glyph.js';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { desktopTray } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';

const MAX_ROWS = 9;

interface TrayRow {
  key: string;
  title: string;
  waiting: boolean;
  at: number;
  path: string;
}

const RUNNER_WORD: Record<DesktopRunnerState, string> = {
  starting: '正在启动',
  on: '运行中',
  off: '已关闭',
  failed: '已停止',
};

const ROUND =
  'flex items-center justify-center rounded-full bg-(--menu-hover) shadow-(--e1) transition-colors hover:bg-(--hover-1) focus-visible:outline-(--focus-ring)';

function channelPath(projectId: string | null): string {
  return projectId === null ? '/app' : `/app?project=${projectId}&chat=1`;
}

function useTrayRows(): TrayRow[] {
  const { live, teamId } = useLiveData();
  const tasksQ = useTasks(teamId, live);
  return useMemo(() => {
    const view = tasksFromQuery(tasksQ.data);
    const rows: TrayRow[] = [
      ...view.questions.map((question) => ({
        key: question.requestId,
        title: question.header,
        waiting: true,
        at: question.createdAt,
        path: channelPath(question.projectId),
      })),
      ...view.entries
        .filter((entry) => isWaiting(entry.section) || entry.section === 'working')
        .map((entry) => ({
          key: entry.todo.id,
          title: entry.todo.title,
          waiting: isWaiting(entry.section),
          at: entry.todo.phaseAt,
          path: threadHref(entry.todo.id, ''),
        })),
    ];
    return rows
      .sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.at - a.at)
      .slice(0, MAX_ROWS);
  }, [tasksQ.data]);
}

function TrayButton({
  label,
  className,
  onClick,
  pressed,
  children,
}: {
  label: string;
  className?: string;
  onClick: () => void;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(ROUND, className)}
    >
      {children}
    </Button>
  );
}

export function TrayPage() {
  const { t } = useI18n();
  const { user } = useLiveData();
  const bridge = useMemo(desktopTray, []);
  const [state, setState] = useState<DesktopTrayState | null>(null);
  const rows = useTrayRows();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (bridge === null) return;
    void bridge.state().then((first) => {
      if (first !== null) setState(first);
    });
    return bridge.subscribe(setState);
  }, [bridge]);

  useEffect(() => {
    const root = rootRef.current;
    if (bridge === null || root === null) return;
    const observer = new ResizeObserver(() => bridge.resize(root.offsetHeight));
    observer.observe(root);
    return () => observer.disconnect();
  }, [bridge]);

  const open = (target: DesktopTrayOpen) => bridge?.open(target);
  const runner = state?.runner ?? 'starting';
  const runnerOn = runner === 'on' || runner === 'starting';
  const keepAwake = state?.keepAwake ?? false;

  return (
    <div
      ref={rootRef}
      data-testid="tray-popover"
      className="flex select-none flex-col gap-3 p-3 text-ui text-foreground"
    >
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          data-testid="tray-new-task"
          onClick={() => open({ kind: 'command', command: 'new-task' })}
          className={cn(ROUND, 'h-16 flex-1 justify-start gap-3 px-5 text-left font-normal')}
        >
          <SquarePen width={22} height={22} aria-hidden="true" />
          <span className="flex flex-col">
            <span className="font-title">{t('新任务')}</span>
            {state?.newTaskKey != null && (
              <span className="text-caption text-content-tertiary">{state.newTaskKey}</span>
            )}
          </span>
        </Button>
        <TrayButton
          label={t('打开 Cairn')}
          className="size-16"
          onClick={() => open({ kind: 'path', path: '/app' })}
        >
          <BrandGlyph className="size-5.5" />
        </TrayButton>
        <TrayButton
          label={t('搜索')}
          className="size-16"
          onClick={() => open({ kind: 'command', command: 'search' })}
        >
          <Search className="size-5.5" aria-hidden="true" />
        </TrayButton>
      </div>

      <ul
        data-testid="tray-rows"
        className="m-0 flex list-none flex-col rounded-(--radius-card) bg-(--menu-hover) p-1"
      >
        <li>
          <TrayRowButton
            title="Coordinator"
            waiting={false}
            onClick={() => open({ kind: 'path', path: '/app' })}
          />
        </li>
        {rows.map((row) => (
          <li key={row.key}>
            <TrayRowButton
              title={row.title}
              waiting={row.waiting}
              onClick={() => open({ kind: 'path', path: row.path })}
            />
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-3 py-2 pl-8 text-meta text-content-tertiary">{t('没有等你的事')}</li>
        )}
      </ul>

      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          role="switch"
          aria-checked={runnerOn}
          data-testid="tray-runner"
          data-state={runner}
          disabled={bridge === null || runner === 'starting'}
          onClick={() => void bridge?.setRunner(!runnerOn)}
          className={cn(ROUND, 'h-16 flex-1 justify-start gap-3 pr-5 pl-2 text-left font-normal')}
        >
          <span
            className={cn(
              'flex size-12 items-center justify-center rounded-full',
              runnerOn ? 'bg-foreground text-background' : 'bg-(--hover-1) text-content-secondary',
            )}
          >
            <Monitor className="size-5.5" aria-hidden="true" />
          </span>
          <span className="flex flex-col">
            <span className="font-title">Runner</span>
            <span
              className={cn(
                'text-meta',
                runner === 'failed' ? 'text-destructive' : 'text-content-tertiary',
              )}
            >
              {t(RUNNER_WORD[runner])}
            </span>
          </span>
        </Button>
        <TrayButton
          label={t('保持 Mac 唤醒')}
          pressed={keepAwake}
          className={cn(
            'size-16',
            keepAwake && 'bg-foreground text-background hover:bg-foreground',
          )}
          onClick={() => bridge?.setKeepAwake(!keepAwake)}
        >
          <Coffee className="size-5.5" aria-hidden="true" />
        </TrayButton>
        <TrayButton
          label={t('设置')}
          className="size-16"
          onClick={() => open({ kind: 'command', command: 'settings' })}
        >
          <Settings className="size-5.5" aria-hidden="true" />
        </TrayButton>
      </div>

      <div className="flex items-center gap-2 px-1">
        <SeededAvatar
          name={user.displayName}
          src={user.avatarUrl}
          fallback={user.displayName.slice(0, 1)}
          className="size-7"
        />
        <span className="min-w-0 flex-1 truncate text-meta font-title">{user.displayName}</span>
        <Button
          variant="ghost"
          data-testid="tray-quit"
          onClick={() => bridge?.quit()}
          className="h-8 rounded-full px-4 text-meta shadow-(--e1) transition-colors hover:bg-(--hover-1)"
        >
          {t('退出 Cairn')}
        </Button>
      </div>
    </div>
  );
}

function TrayRowButton({
  title,
  waiting,
  onClick,
}: {
  title: string;
  waiting: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className="flex h-10 w-full items-center justify-start gap-3 rounded-(--radius-menu-item) px-3 text-left text-ui font-normal transition-colors hover:bg-(--hover-1)"
    >
      <span className="flex w-2 flex-none justify-center">
        {waiting && (
          <span
            aria-hidden="true"
            data-slot="needs-you-dot"
            className="size-1.5 rounded-full bg-(--card-button)"
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </Button>
  );
}
