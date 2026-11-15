import {
  claudeLoginNotice,
  MACHINE_RUNTIMES,
  type MachineRuntime,
  PUBLISHED_PACKAGES,
} from '@cairn/shared';
import { cn } from 'cn';
import { TriangleAlert } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { RUNTIME_LABELS } from '../api/mappers.js';
import { formatClaudeLoginWarning } from '../claude-login-warning.js';
import {
  SETTINGS_ROW_CLS,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '../components/settings-list.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { MachineAgentAccess } from './machine-agent-access.js';
import { offlineGuidance } from './machine-offline.js';

export interface ChiefState {
  host: boolean;
  running: boolean;
  waiting: boolean;
}

const RUNTIME_NAMES: Record<string, string> = {
  ...RUNTIME_LABELS,
  codex: 'Codex',
  gemini: 'Gemini',
};

const LOGIN_STATE = {
  'logged-in': { label: '已登录', dot: 'bg-running', text: 'text-running-text' },
  'logged-out': { label: '未登录', dot: 'bg-(--card-button)', text: 'text-content-secondary' },
  unknown: { label: '状态未知', dot: 'bg-content-dim', text: 'text-content-tertiary' },
} as const;

export function sandboxNotice(capabilities: MachineRow['capabilities']): string | null {
  if (capabilities?.osPlatform !== 'linux') return null;
  const report = capabilities.confinement;
  if (report === undefined) {
    return '这台 Runner 没上报任务沙箱状态，接不了任务。更新 CLI 后在这台机器上运行 `{command} restart`。';
  }
  switch (report.state) {
    case 'ready':
    case 'not-applicable':
      return null;
    case 'checking':
      return '正在检查任务沙箱，检查完才接任务。';
    case 'unavailable': {
      if (report.reason === 'unsupported-platform')
        return '这台机器的系统不支持任务沙箱，接不了任务。';
      const cause = report.reason === 'startup-failed' ? capabilities.confinementCause : undefined;
      switch (cause?.kind) {
        case 'not-own-unit':
          return '任务沙箱没就绪：daemon 没有作为自己的 systemd user unit 运行。在这台机器上运行 `{command} restart`，它会自己起一个；还不行的话，检查 `systemd-run --user` 能不能用。';
        case 'bwrap-missing':
          return '任务沙箱没就绪：这台机器没装 bubblewrap（`bwrap`）。装好后（如 `sudo pacman -S bubblewrap` 或 `sudo apt install bubblewrap`），Runner 每分钟会自己再检查一次。';
        case 'home-overlay-failed':
          return cause.mountPoint === undefined
            ? '任务沙箱没就绪：沙箱没法覆盖你的家目录，常见原因是家目录里有 FUSE 挂载（比如 AppImage 程序）。用 `findmnt -l | grep fuse` 找到它并关掉对应程序，Runner 每分钟会自己再检查一次。'
            : '任务沙箱没就绪：家目录里的 FUSE 挂载 `{mountPoint}` 挡住了沙箱，通常是某个 AppImage 程序在 TMPDIR 指向家目录时留下的。关掉那个程序，或让它的 TMPDIR 指向家目录以外，Runner 每分钟会自己再检查一次。';
        default:
          return '任务沙箱没就绪，这台 Runner 接不了任务。Linux 上 daemon 要作为自己的 systemd user unit 运行，并装好 bubblewrap（`bwrap`）：更新 CLI 后在这台机器上运行 `{command} restart`。';
      }
    }
  }
}

const isMachineRuntime = (value: string): value is MachineRuntime =>
  (MACHINE_RUNTIMES as readonly string[]).includes(value);

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-code text-foreground">
      {children}
    </code>
  );
}

export function TextWithCode({ text }: { text: string }) {
  let offset = 0;
  return (
    <>
      {text.split('`').map((part, order) => {
        const key = offset;
        offset += part.length + 1;
        return order % 2 === 1 ? (
          <InlineCode key={key}>{part}</InlineCode>
        ) : (
          <Fragment key={key}>{part}</Fragment>
        );
      })}
    </>
  );
}

function runtimeAvailability(machine: MachineRow, runtime: string): string {
  if (runtime === 'gemini') return '接入命令闸前不能用';
  if (!isMachineRuntime(runtime)) return '已检测到';
  return (machine.enabledRuntimes ?? []).includes(runtime)
    ? '可用'
    : '没有检测到，装好后重启 Runner';
}

function RuntimeRow({ machine, runtime }: { machine: MachineRow; runtime: string }) {
  const { t } = useI18n();
  const provider = machine.providers?.find((p) => p.runtime === runtime);
  const availability = runtimeAvailability(machine, runtime);
  const available = availability === '可用' || availability === '已检测到';
  const name = RUNTIME_NAMES[runtime] ?? runtime;
  const meta =
    provider === undefined
      ? []
      : [provider.plan, provider.version].filter((part): part is string => part !== null);
  const login = provider === undefined ? null : LOGIN_STATE[provider.login];
  return (
    <div
      data-testid="provider-row"
      data-runtime={runtime}
      data-login={provider?.login}
      data-available={available}
      className={cn(SETTINGS_ROW_CLS, 'flex-wrap gap-y-1')}
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-ui text-foreground">{name}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-meta text-content-tertiary">
          {meta.length > 0 && <span className="font-mono">{meta.join(' · ')}</span>}
          {login !== null && (
            <span className={cn('inline-flex items-center gap-1.5', login.text)}>
              <span aria-hidden className={cn('size-1.5 flex-none rounded-full', login.dot)} />
              {t(login.label)}
            </span>
          )}
          {provider?.login === 'logged-out' && provider.loginCommand !== null && (
            <span>
              {t('在这台 Runner 上运行')}{' '}
              <span data-testid="provider-login-command">
                <InlineCode>{provider.loginCommand}</InlineCode>
              </span>
            </span>
          )}
        </span>
      </span>
      <span
        data-testid="provider-availability"
        className={cn(
          'inline-flex items-center gap-1.5 text-meta',
          available ? 'text-running-text' : 'text-content-tertiary',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'size-1.5 flex-none rounded-full',
            available ? 'bg-running' : 'bg-content-dim',
          )}
        />
        {t(availability)}
      </span>
    </div>
  );
}

export function MachineDetailPane({ machine, chief }: { machine: MachineRow; chief: ChiefState }) {
  const { t } = useI18n();
  const online = machine.online !== false;

  const offline = online
    ? null
    : offlineGuidance(
        { online: false, lastSeenAt: machine.lastSeenAt },
        Date.now(),
        `${PUBLISHED_PACKAGES.cli.command} start`,
        t,
      );
  const notice = claudeLoginNotice(machine.claudeLogin, Date.now());
  const loginWarning = notice === null ? null : formatClaudeLoginWarning(notice, machine.name, t);
  const sandboxKey = online ? sandboxNotice(machine.capabilities) : null;
  const sandbox =
    sandboxKey === null
      ? null
      : t(sandboxKey, {
          command: PUBLISHED_PACKAGES.cli.command,
          mountPoint: machine.capabilities?.confinementCause?.mountPoint ?? '',
        });

  const runtimes: string[] = [
    ...MACHINE_RUNTIMES,
    ...(machine.providers ?? [])
      .map((p) => p.runtime as string)
      .filter((runtime) => !isMachineRuntime(runtime)),
  ];

  const capabilities = machine.capabilities;
  return (
    <div
      data-testid="machine-detail"
      data-machine-id={machine.id}
      className="flex min-w-0 flex-col gap-6 border-t border-border px-4 py-4"
    >
      {!online && (
        <p data-testid="machine-offline-hint" className="m-0 text-meta text-content-tertiary">
          {t('重新连接 {name} 后才能修改它的设置。', { name: machine.name })}
        </p>
      )}
      {(offline !== null ||
        loginWarning !== null ||
        sandbox !== null ||
        chief.running ||
        chief.waiting) && (
        <SettingsSection title={t('状态')}>
          <SettingsCard>
            {offline !== null && (
              <div
                data-testid="machine-recover"
                className="flex flex-col gap-1 settings-flat-block px-4 py-3 text-meta text-content-secondary"
              >
                <span>
                  <TextWithCode text={offline.recovery} />
                </span>
              </div>
            )}
            {loginWarning !== null && (
              <div
                data-testid="claude-login-warning"
                data-login={notice?.kind === 'expired' ? 'expired' : 'expiring'}
                role="status"
                className="flex items-start gap-2 settings-flat-block px-4 py-3 text-meta text-content-secondary"
              >
                <TriangleAlert
                  aria-hidden
                  strokeWidth={1.75}
                  className="mt-0.5 size-4 flex-none text-content-secondary"
                />
                <span>
                  <TextWithCode text={loginWarning} />
                </span>
              </div>
            )}
            {sandbox !== null && (
              <div
                data-testid="machine-sandbox"
                data-sandbox={machine.capabilities?.confinement?.state ?? 'unreported'}
                role="status"
                className="flex items-start gap-2 settings-flat-block px-4 py-3 text-meta text-content-secondary"
              >
                <TriangleAlert
                  aria-hidden
                  strokeWidth={1.75}
                  className="mt-0.5 size-4 flex-none text-content-secondary"
                />
                <span>
                  <TextWithCode text={sandbox} />
                </span>
              </div>
            )}
            {(chief.running || chief.waiting) && (
              <SettingsRow label={t('Coordinator')} hint={t('这台 Runner 在 Coordinator 里的角色')}>
                <span className="flex flex-wrap items-center justify-end gap-x-3 text-meta">
                  {chief.running && (
                    <span
                      className="inline-flex items-center gap-1.5 text-running-text before:block before:size-1.5 before:rounded-full before:bg-running before:content-['']"
                      data-orchestration="running"
                    >
                      {t('Coordinator 回合进行中')}
                    </span>
                  )}
                  {chief.waiting && (
                    <span
                      className="inline-flex items-center gap-1.5 text-content-tertiary before:block before:size-1.5 before:rounded-full before:bg-content-dim before:content-['']"
                      data-orchestration="waiting"
                    >
                      {t('Coordinator 等待 Runner')}
                    </span>
                  )}
                </span>
              </SettingsRow>
            )}
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection
        testId="machine-runtimes"
        title={t('运行时')}
        description={t('这台 Runner 上检测到的执行器。检测到就能接任务，不用开关。')}
      >
        <SettingsCard>
          {runtimes.map((runtime) => (
            <RuntimeRow key={runtime} machine={machine} runtime={runtime} />
          ))}
        </SettingsCard>
      </SettingsSection>

      <MachineAgentAccess machine={machine} />

      {capabilities !== undefined && (
        <SettingsSection testId="machine-capabilities" title={t('能力')}>
          <SettingsCard>
            <SettingsRow label={t('能力')} hint={t('这台 Runner 上报的 MCP 与技能清单')}>
              <span
                className="text-meta text-content-secondary"
                data-machine-capabilities={capabilities === null ? 'unreported' : 'reported'}
              >
                {capabilities === null
                  ? t('能力清单未上报')
                  : t('MCP {n} · 本机技能 {m}', {
                      n: capabilities.mcpServers.length,
                      m: capabilities.skills.length,
                    })}
              </span>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      )}
    </div>
  );
}
