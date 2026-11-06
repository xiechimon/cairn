import type { MachineRuntime, ModelSource, ProviderRecord } from '@cairn/shared';
import { MACHINE_RUNTIMES } from '@cairn/shared';
import { Cpu } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useMachines, useModelSources, useProviders } from '../api/hooks.js';
import { mapMachines } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { ClaudeMark, GeminiMark, PiMark } from '../components/brand-marks.js';
import { EmptyState } from '../components/empty-state.js';
import { type ProviderItem, ProviderPanel } from '../components/providers/provider-panel.js';
import { SegmentedTabs } from '../components/segmented.js';
import { toastError } from '../components/ui/toaster.js';
import type { MachineRow } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { oauthReasonCopy } from '../i18n/oauth-reason.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { PageShell } from '../pages/shell.js';
import { CreateProviderDialog } from './create-provider-dialog.js';
import { PROVIDERS_HREF } from './hrefs.js';
import { ResourceNewButton } from './parts.js';
import {
  ClaudeCodeEditor,
  claudeCodeStatus,
  GeminiEditor,
  PiEditor,
  type ProviderEditActions,
  providerKind,
  providerMark,
  TeamProviderEditor,
} from './provider-editors.js';

const TEAM_SCOPE = 'team';

interface Entry {
  item: ProviderItem;
  editor: ReactNode;
}

const isMachineRuntime = (value: string): value is MachineRuntime =>
  (MACHINE_RUNTIMES as readonly string[]).includes(value);

function scopeLabel(machine: MachineRow, t: TFunc): string {
  if (machine.online === false) return `${machine.name} · ${t('离线')}`;
  if (machine.capabilities?.executor === 'orb') return `${machine.name} · Orb`;
  return machine.name;
}

function sourceFor(machine: MachineRow, sources: readonly ModelSource[]): ModelSource | undefined {
  const claude = sources.filter((s) => s.runtime === 'claude-code');
  return (
    claude.find((s) => s.machineId !== undefined && s.machineId === machine.id) ??
    claude.find((s) => s.machineId === undefined && s.hostname === machine.name)
  );
}

function deadModelIds(sources: readonly ModelSource[]): Set<string> {
  return new Set(
    sources
      .filter((s) => s.runtime === 'pi')
      .flatMap((s) => s.models.filter((m) => m.liveness === 'dead').map((m) => m.id)),
  );
}

function teamEntries(
  providers: readonly ProviderRecord[],
  dead: ReadonlySet<string>,
  actionsFor: (record: ProviderRecord) => ProviderEditActions,
  t: TFunc,
): Entry[] {
  return providers.map((record) => {
    const retired = record.models.filter((m) => dead.has(m.id)).length;
    const parts = [t(providerKind(record)), t('{n} 个模型', { n: record.models.length })];
    if (retired > 0) parts.push(t('{n} 个已下架', { n: retired }));
    return {
      item: {
        id: `provider:${record.id}`,
        name: record.label,
        Mark: providerMark(record),
        status: parts.join(' · '),
        tone: retired > 0 ? 'warn' : 'ok',
      },
      editor: (
        <TeamProviderEditor
          key={record.id}
          record={record}
          deadModels={dead}
          actions={actionsFor(record)}
        />
      ),
    };
  });
}

function machineEntries(
  machine: MachineRow,
  source: ModelSource | undefined,
  providerCount: number,
  toggle: ((runtime: MachineRuntime, next: boolean) => void) | undefined,
  onShowTeam: () => void,
  t: TFunc,
): Entry[] {
  const enabled = new Set(machine.enabledRuntimes ?? []);
  const online = machine.online !== false;
  const switchFor = (runtime: MachineRuntime) => ({
    checked: enabled.has(runtime),
    disabled: toggle === undefined || !online,
    onChange: (next: boolean) => toggle?.(runtime, next),
  });
  const claude = claudeCodeStatus(source, online);
  const bin = typeof source?.bin === 'object' && source.bin !== null ? source.bin : null;
  const offTone = (runtime: MachineRuntime, tone: ProviderItem['tone']) =>
    enabled.has(runtime) ? tone : 'off';
  return [
    {
      item: {
        id: 'claude-code',
        name: 'Claude Code',
        Mark: ClaudeMark,
        version: bin?.version ?? null,
        status: t(claude.status),
        tone: claude.tone === 'warn' ? 'warn' : offTone('claude-code', claude.tone),
        toggle: switchFor('claude-code'),
      },
      editor: (
        <ClaudeCodeEditor source={source} machineName={machine.name} status={claude.status} />
      ),
    },
    {
      item: {
        id: 'pi',
        name: 'pi',
        Mark: PiMark,
        status: online ? t('使用团队的服务商') : t('离线'),
        tone: online ? offTone('pi', 'ok') : 'warn',
        toggle: switchFor('pi'),
      },
      editor: (
        <PiEditor
          machineName={machine.name}
          providerCount={providerCount}
          onShowTeam={onShowTeam}
        />
      ),
    },
    {
      item: {
        id: 'gemini',
        name: 'Gemini CLI',
        Mark: GeminiMark,
        status: t('还没上报'),
        tone: 'off',
        toggle: switchFor('gemini'),
      },
      editor: <GeminiEditor machineName={machine.name} />,
    },
  ];
}

export function ProvidersPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const sourcesQ = useModelSources(teamId, live);
  const providersQ = useProviders(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const mutations = useApiMutations(teamId);
  const [createOpen, setCreateOpen] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const sources = live
    ? (sourcesQ.data?.sources ?? [])
    : (fixture.resources?.providerSources ?? []);
  const providers = live
    ? (providersQ.data?.providers ?? [])
    : (fixture.resources?.providers ?? []);
  const machines = live ? mapMachines(machinesQ.data ?? []) : (fixture.resources?.machines ?? []);

  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (oauth === null) return;
    if (oauth === 'error') {
      setConnectError(oauthReasonCopy(searchParams.get('reason'), t));
      setCreateOpen(true);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('oauth');
    next.delete('reason');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  useEffect(() => {
    if (searchParams.get('add') === null) return;
    setCreateOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const setParams = (patch: Record<string, string | null>, replace = false) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    setSearchParams(params, { replace });
  };

  const scopeParam = searchParams.get('scope');
  const machine = machines.find((m) => m.id !== undefined && m.id === scopeParam);
  const scope = machine?.id ?? TEAM_SCOPE;

  const actionsFor = (record: ProviderRecord): ProviderEditActions =>
    live
      ? {
          patch: (body) =>
            mutations.patchProvider.mutateAsync({ id: record.id, body }).catch((error) => {
              toastError(t('保存失败，请重试。'), error);
              throw error;
            }),
          test: () => mutations.testProvider.mutateAsync(record.id),
          remove: () =>
            mutations.deleteProvider.mutate(record.id, {
              onError: (error) => toastError(t('移除失败，请重试。'), error),
            }),
        }
      : {};

  const toggleRuntime = (target: MachineRow) =>
    live && target.id !== undefined
      ? (runtime: MachineRuntime, next: boolean) => {
          const current = (target.enabledRuntimes ?? []).filter(isMachineRuntime);
          const enabledRuntimes = next
            ? [...new Set([...current, runtime])]
            : current.filter((r) => r !== runtime);
          const id = target.id;
          if (id === undefined) return;
          mutations.patchMachine.mutate(
            { id, body: { enabledRuntimes } },
            { onError: (error) => toastError(t('保存失败，请重试。'), error) },
          );
        }
      : undefined;

  const entries =
    machine === undefined
      ? teamEntries(providers, deadModelIds(sources), actionsFor, t)
      : machineEntries(
          machine,
          sourceFor(machine, sources),
          providers.length,
          toggleRuntime(machine),
          () => setParams({ scope: null, item: null }),
          t,
        );
  const itemParam = searchParams.get('item');
  const selected = entries.find((e) => e.item.id === itemParam) ?? entries[0];

  return (
    <PageShell
      route={PROVIDERS_HREF}
      title={t('模型服务')}
      selected={PROVIDERS_HREF}
      actions={<ResourceNewButton onClick={() => setCreateOpen(true)} />}
      fixture={fixture}
    >
      <div className="mx-auto flex w-full max-w-240 flex-col gap-3 pt-2 pb-16">
        <div className="overflow-x-auto pb-1">
          <SegmentedTabs
            label={t('范围')}
            value={scope}
            onChange={(next) => setParams({ scope: next === TEAM_SCOPE ? null : next, item: null })}
            options={[
              { value: TEAM_SCOPE, label: t('团队') },
              ...machines.flatMap((m) =>
                m.id === undefined ? [] : [{ value: m.id, label: scopeLabel(m, t) }],
              ),
            ]}
          />
        </div>
        <ProviderPanel
          items={entries.map((e) => e.item)}
          selectedId={selected?.item.id ?? null}
          onSelect={(id) => setParams({ item: id })}
          onAdd={machine === undefined ? () => setCreateOpen(true) : undefined}
          empty={
            <EmptyState
              testId="providers-empty"
              icon={Cpu}
              title={t('尚未添加服务商。')}
              description={t('添加 API key、订阅或自定义端点后，它们的模型会出现在这里。')}
            />
          }
        >
          {selected?.editor}
        </ProviderPanel>
      </div>
      <CreateProviderDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setConnectError(null);
        }}
        pending={mutations.createProvider.isPending}
        onCreate={
          live
            ? (body) =>
                mutations.createProvider.mutate(body, {
                  onSuccess: () => setCreateOpen(false),
                  onError: (error) => toastError(t('添加模型服务失败，请重试。'), error),
                })
            : undefined
        }
        onConnect={
          live
            ? (presetId) => {
                setConnectError(null);
                mutations.startProviderOAuth.mutate(presetId, {
                  onSuccess: (data) => window.location.assign(data.authorizationUrl),
                  onError: (err) => setConnectError(err.message),
                });
              }
            : undefined
        }
        connectPending={mutations.startProviderOAuth.isPending}
        connectError={connectError}
      />
    </PageShell>
  );
}
