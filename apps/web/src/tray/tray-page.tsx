import type { DesktopRunnerState, DesktopTrayOpen, DesktopTrayState } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { ChartColumn, Coffee, Laptop, Settings } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useClaudeSubscriptions, useRefreshClaudeQuota } from '../api/claude-subscriptions.js';
import { useChiefThreads, useMachines, useTasks } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useDailyUsage } from '../api/usage-daily.js';
import { tasksFromQuery } from '../board/tasks-sections.js';
import { threadTurnInFlight } from '../chief/orchestration-inflight.js';
import { BrandGlyph } from '../components/brand-glyph.js';
import { MachineIcon } from '../components/machine-label.js';
import { StatusGlyph } from '../components/status-glyph.js';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { desktopTray } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';
import { USAGE_PATH } from '../resources/hrefs.js';
import {
  type TrayGroup,
  type TrayText,
  type TrayUsage,
  trayGroups,
  trayUsage,
} from './tray-groups.js';
import { TrayHeadMeta } from './tray-meta.js';

const ON_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh');

const RUNNER_WORD: Record<DesktopRunnerState, string> = {
  starting: '正在启动',
  on: '运行中',
  off: '已关闭',
  failed: '已停止',
};

const TRAY_REFRESH_MS = 30_000;
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function useTrayData(): { groups: TrayGroup[]; usage: TrayUsage | null; coordinatorBusy: boolean } {
  const { live, teamId } = useLiveData();
  const client = useQueryClient();
  const [now, setNow] = useState(Date.now);
  const tasksQ = useTasks(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const usageQ = useDailyUsage(teamId, 1, TIME_ZONE, live);
  const subscriptionsQ = useClaudeSubscriptions(teamId, live);
  const refreshQuota = useRefreshClaudeQuota(teamId).mutate;
  const threadsQ = useChiefThreads(teamId, live);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void client.invalidateQueries({ queryKey: ['machines', teamId] });
      void client.invalidateQueries({ queryKey: ['usage-daily', teamId] });
    }, TRAY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [client, teamId]);

  useEffect(() => {
    if (!live || teamId === undefined) return;
    const onShow = () => {
      if (document.visibilityState === 'visible') refreshQuota();
    };
    onShow();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [live, teamId, refreshQuota]);

  const groups = useMemo(
    () => trayGroups(tasksFromQuery(tasksQ.data), machinesQ.data, now),
    [tasksQ.data, machinesQ.data, now],
  );
  const usage = useMemo(
    () => trayUsage(usageQ.data, subscriptionsQ.data, now),
    [usageQ.data, subscriptionsQ.data, now],
  );
  return { groups, usage, coordinatorBusy: threadsQ.data?.some(threadTurnInFlight) ?? false };
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
  warn = false,
  tip,
  keepLabel = false,
  testId,
  onClick,
}: {
  glyph?: ReactNode;
  label: string;
  hint?: string;
  warn?: boolean;
  tip?: string;
  keepLabel?: boolean;
  testId?: string;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="ghost"
      role="menuitem"
      data-testid={testId}
      title={tip}
      className={cn('tray-item', keepLabel && 'tray-item-keep')}
      disabled={onClick === undefined}
      onClick={onClick}
    >
      <span className="tray-item-glyph">{glyph}</span>
      <span className="tray-item-label">{label}</span>
      {hint !== undefined && (
        <span className={cn('tray-item-hint', warn && 'tray-warn')}>{hint}</span>
      )}
    </Button>
  );
}

export function TrayPage() {
  const { t } = useI18n();
  const { user } = useLiveData();
  const bridge = useMemo(desktopTray, []);
  const [state, setState] = useState<DesktopTrayState | null>(null);
  const { groups, usage, coordinatorBusy } = useTrayData();
  const say = (text: TrayText) => t(text.key, text.vars);
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
      <div data-testid="tray-rows" className="flex flex-col">
        <TrayItem
          glyph={<BrandGlyph className="size-4" />}
          label="Coordinator"
          hint={coordinatorBusy ? t('正在回复') : undefined}
          onClick={() => open({ kind: 'path', path: '/app' })}
        />
        {groups.map((group) => (
          <section key={group.key} aria-label={t(group.label)} className="flex flex-col">
            <h2 className="tray-head">
              <span className="tray-head-name">
                {group.os !== undefined && (
                  <MachineIcon machine={{ capabilities: group.os }} className="size-3" />
                )}
                <span className="min-w-0 truncate">
                  {group.literal ? group.label : t(group.label)}
                </span>
              </span>
              {group.meta !== undefined && (
                <TrayHeadMeta meta={group.meta} tip={say(group.meta.tip)} />
              )}
            </h2>
            {group.rows.map((row) => (
              <TrayItem
                key={row.key}
                glyph={row.note === undefined ? <StatusGlyph kind={row.glyph} /> : undefined}
                label={row.note === undefined ? row.title : say(row.note)}
                hint={row.hint === undefined ? undefined : say(row.hint)}
                warn={row.warn}
                tip={row.tip === undefined ? undefined : say(row.tip)}
                onClick={() => open({ kind: 'path', path: row.path })}
              />
            ))}
          </section>
        ))}
        {groups.length === 0 && <TrayItem label={t('没有等你的事')} />}
      </div>

      {usage !== null && (
        <>
          <div className="tray-rule" />
          <div className="flex flex-col">
            <TrayItem
              testId="tray-usage"
              keepLabel
              glyph={<ChartColumn className="size-4" aria-hidden="true" />}
              label={t('今天用了 {tokens} tokens', { tokens: usage.tokens })}
              hint={usage.quota === null ? undefined : say(usage.quota)}
              onClick={() => open({ kind: 'path', path: USAGE_PATH })}
            />
          </div>
        </>
      )}

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
            <span className="tray-tile-title">{t('本机执行机')}</span>
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
