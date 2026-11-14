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
import { ExplainDisabledToggle, ToggleSwitch } from '../components/toggle-switch.js';
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

function RuntimeRow({
  machine,
  runtime,
  frozen,
  blockedReason,
  onToggle,
}: {
  machine: MachineRow;
  runtime: string;
  frozen: boolean;
  blockedReason: string | undefined;
  onToggle: (runtime: MachineRuntime, next: boolean) => void;
}) {
  const { t } = useI18n();
  const provider = machine.providers?.find((p) => p.runtime === runtime);
  const toggleable = isMachineRuntime(runtime);
  const enabled = toggleable
    ? (machine.enabledRuntimes ?? []).includes(runtime)
    : (provider?.enabled ?? false);
  const name = RUNTIME_NAMES[runtime] ?? runtime;
  const meta =
    provider === undefined
      ? []
      : [provider.plan, provider.version].filter((part): part is string => part !== null);
  const login = provider === undefined ? null : LOGIN_STATE[provider.login];
  const switchDisabled = !toggleable || frozen;
  const reason = !toggleable
    ? t('这台机器还不能单独开关 {name}', { name })
    : frozen
      ? blockedReason
      : undefined;
  return (
    <div
      data-testid="provider-row"
      data-runtime={runtime}
      data-login={provider?.login}
      data-enabled={enabled}
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
              {t('在这台机器上运行')}{' '}
              <span data-testid="provider-login-command">
                <InlineCode>{provider.loginCommand}</InlineCode>
              </span>
            </span>
          )}
          {provider === undefined && <span>{enabled ? t('接任务中') : t('未开启')}</span>}
        </span>
      </span>
      <ExplainDisabledToggle disabled={switchDisabled} reason={reason}>
        <ToggleSwitch
          data-testid="provider-toggle"
          aria-label={t('{name} 接任务', { name })}
          checked={enabled}
          disabled={switchDisabled}
          title={reason}
          onCheckedChange={(next) => {
            if (toggleable) onToggle(runtime, next);
          }}
        />
      </ExplainDisabledToggle>
    </div>
  );
}

export function MachineDetailPane({
  machine,
  chief,
  pending,
  onToggleRuntime,
}: {
  machine: MachineRow;
  chief: ChiefState;
  pending: boolean;
  onToggleRuntime: (runtime: MachineRuntime, next: boolean) => void;
}) {
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
      {(offline !== null || loginWarning !== null || chief.running || chief.waiting) && (
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
            {(chief.running || chief.waiting) && (
              <SettingsRow label={t('Coordinator')} hint={t('这台机器在 Coordinator 里的角色')}>
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
                      {t('Coordinator 等待机器')}
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
        description={t('这台机器上能接任务的执行器，以及它们的登录状态。')}
      >
        {online && !(machine.enabledRuntimes ?? []).some(isMachineRuntime) && (
          <p data-testid="machine-pick-runtimes" className="m-0 text-meta text-content-secondary">
            {t('选择这台机器接哪些运行时')}
          </p>
        )}
        <SettingsCard>
          {runtimes.map((runtime) => (
            <RuntimeRow
              key={runtime}
              machine={machine}
              runtime={runtime}
              frozen={pending || !online}
              blockedReason={
                online
                  ? undefined
                  : t('重新连接 {name} 后才能修改它的设置。', { name: machine.name })
              }
              onToggle={onToggleRuntime}
            />
          ))}
        </SettingsCard>
      </SettingsSection>

      <MachineAgentAccess machine={machine} />

      {capabilities !== undefined && (
        <SettingsSection testId="machine-capabilities" title={t('能力')}>
          <SettingsCard>
            <SettingsRow label={t('能力')} hint={t('这台机器上报的 MCP 与技能清单')}>
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
