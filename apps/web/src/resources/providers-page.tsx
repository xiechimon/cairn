import { MODEL_SOURCE_RUNTIMES, type ModelSource, type ModelSourceRuntime } from '@cairn/shared';
import { cn } from 'cn';
import { CircleAlert, CircleCheck, Cpu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useModelSources } from '../api/hooks.js';
import { RUNTIME_LABELS } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { ClaudeMark, GeminiMark, PiMark } from '../components/brand-marks.js';
import { EmptyState } from '../components/empty-state.js';
import { SegmentedTabs } from '../components/segmented.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { oauthReasonCopy } from '../i18n/oauth-reason.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { CreateProviderDialog } from './create-provider-dialog.js';
import {
  ResourceList,
  ResourceNewButton,
  ResourceRow,
  RowDesc,
  RowMeta,
  RowText,
  RowTitle,
} from './parts.js';

export const PROVIDERS_HREF = '/app/resources/providers';

const RUNTIME_DESCRIPTIONS: Record<ModelSourceRuntime, string> = {
  pi: 'cairn 自有运行时。模型来自你添加的服务商。',
  'claude-code': '执行机 Claude Code 配置（~/.claude/settings.json）的模型槽。',
  gemini: '执行机 Gemini CLI 的本地会话。',
};

const RUNTIME_MARKS: Record<ModelSourceRuntime, typeof PiMark> = {
  pi: PiMark,
  'claude-code': ClaudeMark,
  gemini: GeminiMark,
};

const NEEDS_YOU_INK = 'text-(--card-button)';

const isRuntime = (value: string | null): value is ModelSourceRuntime =>
  value !== null && (MODEL_SOURCE_RUNTIMES as readonly string[]).includes(value);

function parseRuntime(searchParams: URLSearchParams): ModelSourceRuntime {
  const raw = searchParams.get('runtime');
  return isRuntime(raw) ? raw : 'pi';
}

type HeadState = 'installed' | 'no-config' | 'bin-missing' | 'unknown';

function headState(source: ModelSource): HeadState {
  const bin = source.bin;
  if (typeof bin === 'object' && bin !== null) return source.installed ? 'installed' : 'no-config';
  if (bin === null) return 'bin-missing';
  return source.installed ? 'installed' : 'unknown';
}

function RuntimeHead({ source }: { source: ModelSource }) {
  const { t } = useI18n();
  const bin = source.bin;
  const state = headState(source);
  const binFound = typeof bin === 'object' && bin !== null;
  const notLoggedIn = source.auth?.state === 'not-logged-in';
  const guidance =
    state === 'no-config'
      ? t(
          '在该机器上写 ~/.claude/settings.json 的 env.ANTHROPIC_*_MODEL 槽后，此处自动展示其模型槽。',
        )
      : state === 'bin-missing' || state === 'unknown'
        ? t('安装 Claude Code 并完成一次登录后，此处自动展示其模型槽。')
        : null;
  const needsYou = state === 'bin-missing' || state === 'unknown';
  const StateIcon = needsYou ? CircleAlert : CircleCheck;
  return (
    <div
      data-testid="runtime-head"
      data-runtime={source.runtime}
      data-auth={source.auth?.state}
      data-state={state}
      className="mt-6 flex flex-col gap-0.5 px-1"
    >
      <div className="flex items-center gap-2">
        <span className="text-ui font-medium text-foreground">
          {RUNTIME_LABELS[source.runtime]}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 text-meta',
            needsYou ? NEEDS_YOU_INK : 'text-content-tertiary',
          )}
        >
          <StateIcon aria-hidden strokeWidth={1.75} className="size-3.5" />
          {state === 'installed'
            ? t('已安装在 {hostname}', { hostname: source.hostname })
            : state === 'no-config'
              ? t('已安装，未配置模型槽')
              : t('未安装')}
        </span>
      </div>
      {binFound && (
        <p data-testid="runtime-bin" className="m-0 text-meta text-content-tertiary">
          {`claude${bin.version !== null ? ` ${bin.version}` : ''} · ${bin.path}`}
          {notLoggedIn && <span className={NEEDS_YOU_INK}>{` · ${t('未登录')}`}</span>}
        </p>
      )}
      <p className="m-0 text-meta text-content-tertiary">
        {t(RUNTIME_DESCRIPTIONS[source.runtime])}
      </p>
      {guidance !== null && <p className="m-0 text-meta text-content-tertiary">{guidance}</p>}
    </div>
  );
}

export function ProvidersPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const sourcesQ = useModelSources(teamId, live);
  const sources = live
    ? (sourcesQ.data?.sources ?? [])
    : (fixture.resources?.providerSources ?? []);
  const runtime = parseRuntime(searchParams);
  const matching = sources.filter((source) => source.runtime === runtime);
  const mutations = useApiMutations(teamId);
  const [createOpen, setCreateOpen] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

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

  const selectRuntime = (next: ModelSourceRuntime) => {
    const params = new URLSearchParams(searchParams);
    params.set('runtime', next);
    setSearchParams(params);
  };

  return (
    <PageShell
      route={PROVIDERS_HREF}
      title={t('模型服务')}
      selected={PROVIDERS_HREF}
      actions={<ResourceNewButton onClick={() => setCreateOpen(true)} />}
      fixture={fixture}
    >
      <SegmentedTabs
        label={t('模型服务')}
        value={runtime}
        onChange={selectRuntime}
        options={MODEL_SOURCE_RUNTIMES.map((rt) => {
          const Mark = RUNTIME_MARKS[rt];
          return {
            value: rt,
            label: RUNTIME_LABELS[rt],
            icon: <Mark className="block flex-none" />,
            data: { 'data-runtime': rt },
          };
        })}
      />
      {matching.map((source, si) => (
        <div key={`${source.hostname}:${si}`}>
          <RuntimeHead source={source} />
          {source.models.length > 0 ? (
            <ResourceList className="mt-3">
              {source.models.map((model, i) => (
                <ResourceRow
                  key={`${model.id}:${i}`}
                  className={cn(model.liveness === 'dead' && 'opacity-50')}
                  data-runtime={source.runtime}
                  data-model-id={model.id}
                  data-liveness={model.liveness ?? 'unknown'}
                >
                  <RowText>
                    <RowTitle>{model.name}</RowTitle>
                    <RowDesc>{model.id}</RowDesc>
                  </RowText>
                  {(model.slot != null || model.liveness === 'dead') && (
                    <span className="flex items-center gap-3">
                      {model.liveness === 'dead' && <RowMeta>{t('已下架')}</RowMeta>}
                      {model.slot != null && <RowMeta className="font-mono">{model.slot}</RowMeta>}
                    </span>
                  )}
                </ResourceRow>
              ))}
            </ResourceList>
          ) : source.runtime === 'pi' ? (
            <EmptyState
              testId="runtime-empty"
              className="mt-3"
              icon={Cpu}
              title={t('尚未添加服务商。')}
              description={t('添加后，服务商的模型会出现在这里。')}
              action={{ label: t('添加模型服务'), onClick: () => setCreateOpen(true) }}
            />
          ) : (
            source.installed && (
              <EmptyState
                testId="runtime-empty"
                className="mt-3"
                icon={Cpu}
                title={t('settings.json 未配置模型槽。')}
              />
            )
          )}
        </div>
      ))}
      {matching.length === 0 && (
        <EmptyState
          testId="runtime-empty"
          className="mt-6"
          icon={Cpu}
          title={t('尚无执行机上报模型信息。')}
        />
      )}
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
