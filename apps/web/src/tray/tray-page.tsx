import type { DesktopRunnerState, DesktopTrayOpen, DesktopTrayState } from '@cairn/shared';
import { cn } from 'cn';
import { Coffee, Laptop, Search, Settings, SquarePen } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTasks } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { tasksFromQuery } from '../board/tasks-sections.js';
import { BrandGlyph } from '../components/brand-glyph.js';
import { StatusGlyph } from '../components/status-glyph.js';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { desktopTray } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';
import { type TrayGroup, trayGroups } from './tray-groups.js';

const ON_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh');

const RUNNER_WORD: Record<DesktopRunnerState, string> = {
  starting: '正在启动',
  on: '运行中',
  off: '已关闭',
  failed: '已停止',
};

function useTrayGroups(): TrayGroup[] {
  const { live, teamId } = useLiveData();
  const tasksQ = useTasks(teamId, live);
  return useMemo(() => trayGroups(tasksFromQuery(tasksQ.data)), [tasksQ.data]);
}

function moveFocus(event: KeyboardEvent<HTMLDivElement>, hide: () => void) {
  if (event.key === 'Escape') {
    event.preventDefault();
    hide();
    return;
  }
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:enabled')];
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = at === -1 ? (step === 1 ? 0 : items.length - 1) : at + step;
  items[(next + items.length) % items.length]?.focus();
}

function TrayItem({
  glyph,
  label,
  hint,
  testId,
  onClick,
}: {
  glyph?: ReactNode;
  label: string;
  hint?: string;
  testId?: string;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="ghost"
      role="menuitem"
      data-testid={testId}
      className="tray-item"
      disabled={onClick === undefined}
      onClick={onClick}
    >
      <span className="tray-item-glyph">{glyph}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint !== undefined && <span className="tray-item-hint">{hint}</span>}
    </Button>
  );
}

export function TrayPage() {
  const { t } = useI18n();
  const { user } = useLiveData();
  const bridge = useMemo(desktopTray, []);
  const [state, setState] = useState<DesktopTrayState | null>(null);
  const groups = useTrayGroups();
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

  useEffect(() => {
    const forget = () => (document.activeElement as HTMLElement | null)?.blur();
    window.addEventListener('blur', forget);
    return () => window.removeEventListener('blur', forget);
  }, []);

  const open = (target: DesktopTrayOpen) => bridge?.open(target);
  const runner = state?.runner ?? 'starting';
  const runnerOn = runner === 'on' || runner === 'starting';
  const keepAwake = state?.keepAwake ?? false;
  const accent = state?.accent == null ? {} : { '--tray-accent': state.accent };

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="Cairn"
      data-testid="tray-popover"
      className={cn('tray-pop', !ON_MAC && 'tray-pop-opaque')}
      style={accent as CSSProperties}
      onKeyDown={(event) => moveFocus(event, () => bridge?.hide())}
    >
      <div className="tray-row">
        <Button
          variant="ghost"
          data-testid="tray-new-task"
          className="tray-tile"
          onClick={() => open({ kind: 'command', command: 'new-task' })}
        >
          <SquarePen className="size-5" aria-hidden="true" />
          <span className="min-w-0">
            <span className="tray-tile-title">{t('新任务')}</span>
            {state?.newTaskKey != null && <span className="tray-tile-sub">{state.newTaskKey}</span>}
          </span>
        </Button>
        <Button
          variant="ghost"
          className="tray-disc"
          title={t('打开 Cairn')}
          aria-label={t('打开 Cairn')}
          onClick={() => open({ kind: 'path', path: '/app' })}
        >
          <BrandGlyph className="size-5" />
        </Button>
        <Button
          variant="ghost"
          className="tray-disc"
          title={t('搜索')}
          aria-label={t('搜索')}
          onClick={() => open({ kind: 'command', command: 'search' })}
        >
          <Search className="size-5" aria-hidden="true" />
        </Button>
      </div>

      <div data-testid="tray-rows" className="flex flex-col">
        <TrayItem
          glyph={<BrandGlyph className="size-4" />}
          label="Coordinator"
          onClick={() => open({ kind: 'path', path: '/app' })}
        />
        {groups.map((group) => (
          <section key={group.key} aria-label={t(group.label)} className="flex flex-col">
            <h2 className="tray-head">{t(group.label)}</h2>
            {group.rows.map((row) => (
              <TrayItem
                key={row.key}
                glyph={<StatusGlyph kind={row.glyph} />}
                label={row.title}
                onClick={() => open({ kind: 'path', path: row.path })}
              />
            ))}
          </section>
        ))}
        {groups.length === 0 && <TrayItem label={t('没有等你的事')} />}
      </div>

      <div className="tray-row">
        <Button
          variant="ghost"
          role="switch"
          aria-checked={runnerOn}
          data-testid="tray-runner"
          data-state={runner}
          disabled={bridge === null || runner === 'starting'}
          className="tray-tile"
          onClick={() => void bridge?.setRunner(!runnerOn)}
        >
          <span className="tray-badge">
            <Laptop className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="tray-tile-title">Runner</span>
            <span className="tray-tile-sub">{t(RUNNER_WORD[runner])}</span>
          </span>
        </Button>
        <Button
          variant="ghost"
          role="switch"
          aria-checked={keepAwake}
          className="tray-disc"
          title={t('保持 Mac 唤醒')}
          aria-label={t('保持 Mac 唤醒')}
          onClick={() => bridge?.setKeepAwake(!keepAwake)}
        >
          <Coffee className="size-5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          className="tray-disc"
          title={t('设置')}
          aria-label={t('设置')}
          onClick={() => open({ kind: 'command', command: 'settings' })}
        >
          <Settings className="size-5" aria-hidden="true" />
        </Button>
      </div>

      <div className="tray-rule" />
      <div className="flex flex-col">
        <TrayItem
          glyph={
            <SeededAvatar
              name={user.displayName}
              src={user.avatarUrl}
              fallback={user.displayName.slice(0, 1)}
              className="size-4"
            />
          }
          label={user.displayName}
        />
        <TrayItem
          label={t('退出 Cairn')}
          testId="tray-quit"
          hint={ON_MAC ? '⌘Q' : undefined}
          onClick={() => bridge?.quit()}
        />
      </div>
    </div>
  );
}
