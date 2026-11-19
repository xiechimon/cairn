import {
  PROVIDER_OAUTH_PRESET_IDS,
  PROVIDER_PRESET_IDS,
  type ProviderApi,
  type ProviderFailure,
  type ProviderRecord,
  type ProviderTestResult,
  type UpstreamModelsResult,
} from '@cairn/shared';
import { cn } from 'cn';
import { Download, Play, Server, X } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { AnthropicMark } from '../components/brand-marks.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { ProviderEditorHead, type ProviderMark } from '../components/providers/provider-panel.js';
import { SettingsDangerZone, SettingsSection } from '../components/settings-list.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Spinner } from '../components/ui/spinner.js';
import { useI18n } from '../i18n/provider.js';
import { presetMarkOf } from './provider-preset-icon.js';
import { UpstreamModelPicker } from './upstream-model-picker.js';

const PROTOCOL_LABELS: Record<ProviderApi, string> = {
  'anthropic-messages': 'Anthropic Messages',
  'openai-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
};

const SUBSCRIPTION_PRESET_IDS: readonly string[] = ['openai-codex'];

const isOAuthPreset = (providerId: string) =>
  (PROVIDER_OAUTH_PRESET_IDS as readonly string[]).includes(providerId);

export function providerKind(record: ProviderRecord): string {
  if (SUBSCRIPTION_PRESET_IDS.includes(record.providerId)) return '订阅';
  if (isOAuthPreset(record.providerId)) return 'OAuth';
  if ((PROVIDER_PRESET_IDS as readonly string[]).includes(record.providerId)) return 'API key';
  return '自定义端点';
}

export function providerMark(record: ProviderRecord): ProviderMark {
  const preset = presetMarkOf(record.providerId);
  if (preset !== undefined) return preset;
  if (record.api === 'anthropic-messages') return AnthropicMark;
  return Server;
}

export function CommitInput({
  label,
  value,
  onCommit,
  className,
}: {
  label: string;
  value: string;
  onCommit?: (next: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const next = draft?.trim() ?? '';
    if (draft !== null && next !== '' && next !== value) onCommit?.(next);
    setDraft(null);
  };
  return (
    <Input
      aria-label={label}
      className={cn(FORM_CONTROL_CLS, 'w-full sm:w-64', className)}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-meta text-content-tertiary">{label}</span>
      {children}
    </div>
  );
}

function KeyField({ onReplace }: { onReplace?: (key: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <span className="flex h-8 min-w-0 items-center justify-between gap-2 rounded-md px-2.5 ring-1 ring-input ring-inset">
        <span className="truncate text-meta text-content-tertiary">{t('已加密保存')}</span>
        <Button variant="ghost" size="xs" onClick={() => setDraft('')}>
          {t('更换')}
        </Button>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Input
        aria-label={t('新的 API key')}
        type="password"
        autoComplete="off"
        autoFocus
        className={cn(FORM_CONTROL_CLS, 'min-w-0 flex-auto')}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDraft(null);
          if (event.key === 'Enter' && draft.trim() !== '') {
            onReplace?.(draft.trim());
            setDraft(null);
          }
        }}
      />
      <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
        {t('取消')}
      </Button>
      <Button
        size="sm"
        disabled={draft.trim() === ''}
        onClick={() => {
          onReplace?.(draft.trim());
          setDraft(null);
        }}
      >
        {t('保存')}
      </Button>
    </span>
  );
}

export interface ProviderEditActions {
  patch?: (
    body: Partial<Pick<ProviderRecord, 'label' | 'baseUrl' | 'models'>> & {
      apiKey?: string;
    },
  ) => Promise<unknown>;
  test?: (model: string) => Promise<ProviderTestResult>;
  listUpstream?: () => Promise<UpstreamModelsResult>;
  remove?: () => void;
}

type ModelCheck =
  | { phase: 'running' }
  | { phase: 'done'; result: ProviderTestResult }
  | { phase: 'unavailable' };

const FAILURE_SHORT: Record<ProviderFailure, string> = {
  auth: 'key 无效',
  'not-found': '模型不存在',
  'rate-limit': '限流',
  timeout: '超时',
  upstream: '上游出错',
  invalid: '响应异常',
  network: '连不上',
  'no-model': '没有模型',
};

const FAILURE_SENTENCE: Record<ProviderFailure, string> = {
  auth: 'API key 无效或没有这个模型的权限',
  'not-found': '上游没有这个模型',
  'rate-limit': '上游限流了，稍后再测',
  timeout: '10 秒内没回',
  upstream: '上游返回了错误',
  invalid: '上游返回的内容不像模型回复',
  network: '连不上上游，检查地址',
  'no-model': '没有可测的模型',
};

const TEST_CONCURRENCY = 3;

function failureOf(check: ModelCheck | undefined): ProviderFailure | 'unavailable' | null {
  if (check?.phase === 'unavailable') return 'unavailable';
  if (check?.phase === 'done' && check.result.status === 'failed') {
    return check.result.failure ?? 'upstream';
  }
  return null;
}

function ModelChip({
  id,
  dead,
  check,
  busy,
  onTest,
  onRemove,
}: {
  id: string;
  dead: boolean;
  check: ModelCheck | undefined;
  busy: boolean;
  onTest?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  const failure = failureOf(check);
  const latency = check?.phase === 'done' ? check.result.latencyMs : null;
  return (
    <span
      data-testid="provider-model"
      data-model-id={id}
      data-liveness={dead ? 'dead' : 'alive'}
      data-check={
        check === undefined
          ? 'none'
          : check.phase === 'running'
            ? 'running'
            : failure === null
              ? 'ok'
              : 'failed'
      }
      className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md bg-secondary py-0.5 pr-0.5 pl-2.5 text-ui text-foreground ring-1 ring-border pointer-coarse:min-h-9"
    >
      <span
        className={cn(
          'min-w-0 [overflow-wrap:anywhere]',
          dead && 'text-content-tertiary line-through',
        )}
      >
        {id}
      </span>
      {dead && <span className="flex-none text-meta text-content-tertiary">{t('已下架')}</span>}
      {check?.phase === 'running' && (
        <Spinner aria-label={t('测试中')} className="size-3.5 flex-none text-content-tertiary" />
      )}
      {check !== undefined && check.phase !== 'running' && (
        <span
          data-testid="provider-model-check"
          className={cn(
            'flex flex-none items-center gap-1 text-meta tabular-nums',
            failure === null ? 'text-content-tertiary' : 'text-destructive',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              failure === null ? 'bg-running' : 'bg-destructive',
            )}
          />
          {failure === null
            ? `${latency ?? 0} ms`
            : failure === 'unavailable'
              ? t('没测完')
              : t(FAILURE_SHORT[failure])}
        </span>
      )}
      {onTest !== undefined && (
        <IconTooltip
          label={t('测试 {name}', { name: id })}
          trigger={
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-content-tertiary"
              disabled={check?.phase === 'running'}
              onClick={onTest}
            />
          }
        >
          <Play aria-hidden />
        </IconTooltip>
      )}
      {onRemove !== undefined && (
        <IconTooltip
          label={t('移除 {name}', { name: id })}
          trigger={
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-content-tertiary"
              disabled={busy}
              onClick={onRemove}
            />
          }
        >
          <X aria-hidden />
        </IconTooltip>
      )}
    </span>
  );
}

function modelsEndpoint(record: ProviderRecord): string {
  const root = record.baseUrl.replace(/\/+$/, '');
  return `GET ${/\/v\d+$/.test(root) ? `${root}/models` : `${root}/v1/models`}`;
}

export function TeamProviderEditor({
  record,
  deadModels,
  actions,
}: {
  record: ProviderRecord;
  deadModels: ReadonlySet<string>;
  actions: ProviderEditActions;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [models, setModels] = useState(record.models);
  const [savedModels, setSavedModels] = useState(record.models);
  const [savingModels, setSavingModels] = useState(false);
  const [checks, setChecks] = useState<Record<string, ModelCheck>>({});
  const generation = useRef(0);
  const connection = `${record.api}|${record.baseUrl}|${record.authHeader}`;
  const [checkedConnection, setCheckedConnection] = useState(connection);
  if (checkedConnection !== connection) {
    generation.current += 1;
    setCheckedConnection(connection);
    setChecks({});
  }
  if (savedModels !== record.models && !savingModels) {
    setSavedModels(record.models);
    setModels(record.models);
  }
  const oauth = isOAuthPreset(record.providerId);
  const test = actions.test;
  const fire = (body: Parameters<NonNullable<ProviderEditActions['patch']>>[0]) => {
    if (body.apiKey !== undefined || body.baseUrl !== undefined) {
      generation.current += 1;
      setChecks({});
    }
    void actions.patch?.(body).catch(() => undefined);
  };
  const saveModels = (next: ProviderRecord['models']) => {
    if (actions.patch === undefined) return Promise.resolve(false);
    setModels(next);
    setSavingModels(true);
    return actions
      .patch({ models: next })
      .then(() => true)
      .catch(() => {
        setModels(record.models);
        return false;
      })
      .finally(() => setSavingModels(false));
  };
  const runTests = async (ids: readonly string[]) => {
    if (test === undefined || ids.length === 0) return;
    const started = generation.current;
    setChecks((prev) => ({
      ...prev,
      ...Object.fromEntries(ids.map((id) => [id, { phase: 'running' }])),
    }));
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const model = id;
        const outcome: ModelCheck = await test(model).then(
          (result) => ({ phase: 'done', result }),
          () => ({ phase: 'unavailable' }),
        );
        if (generation.current === started) setChecks((prev) => ({ ...prev, [model]: outcome }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(TEST_CONCURRENCY, ids.length) }, worker));
  };
  const removeModel = (id: string) => {
    void saveModels(models.filter((m) => m.id !== id));
    setChecks(({ [id]: _, ...rest }) => rest);
  };
  const ids = models.map((m) => m.id);
  const running = ids.filter((id) => checks[id]?.phase === 'running').length;
  const tested = ids.filter((id) => checks[id] !== undefined && checks[id].phase !== 'running');
  const failed = ids.filter((id) => failureOf(checks[id]) !== null);
  const summary =
    ids.length === 0
      ? null
      : running > 0
        ? t('测试中 {done}/{n}', { done: ids.length - running, n: ids.length })
        : tested.length > 0
          ? failed.length > 0
            ? t('{ok} 个可用 · {failed} 个失败', {
                ok: tested.length - failed.length,
                failed: failed.length,
              })
            : t('{ok} 个可用', { ok: tested.length })
          : t('{n} 个', { n: ids.length });
  return (
    <>
      <ProviderEditorHead
        Mark={providerMark(record)}
        name={record.label}
        kind={t(providerKind(record))}
      />
      <div className="@container">
        <div
          data-testid="provider-connection"
          className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)]"
        >
          <Field label={t('名称')}>
            <CommitInput
              key={`label:${record.label}`}
              label={t('名称')}
              value={record.label}
              className="sm:w-full"
              onCommit={(label) => fire({ label })}
            />
          </Field>
          <Field label={t('协议')}>
            <span className="flex h-8 items-center truncate text-ui text-foreground">
              {PROTOCOL_LABELS[record.api]}
            </span>
          </Field>
          <Field label={t('地址')}>
            <CommitInput
              key={`base:${record.baseUrl}`}
              label={t('地址')}
              value={record.baseUrl}
              className="font-mono sm:w-full"
              onCommit={(baseUrl) => fire({ baseUrl })}
            />
          </Field>
          {!oauth && (
            <Field label="API key">
              <KeyField onReplace={(apiKey) => fire({ apiKey })} />
            </Field>
          )}
        </div>
      </div>
      <section data-testid="provider-models" className="flex min-w-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <h3 className="m-0 text-ui font-semibold text-foreground">{t('模型')}</h3>
          {summary !== null && (
            <span data-testid="provider-models-summary" className="text-meta text-content-tertiary">
              {summary}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 max-sm:w-full max-sm:justify-end">
            {actions.listUpstream !== undefined && (
              <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
                <Download aria-hidden />
                {t('从上游选择')}
              </Button>
            )}
            {test !== undefined && (
              <Button
                variant="outline"
                size="sm"
                data-testid="provider-test-all"
                className="min-w-24"
                disabled={running > 0 || ids.length === 0}
                onClick={() => void runTests(ids)}
              >
                {running > 0 ? <Spinner aria-hidden /> : <Play aria-hidden />}
                {running > 0 ? t('测试中') : t('全部测试')}
              </Button>
            )}
          </span>
        </div>
        {ids.length === 0 ? (
          <p className="m-0 py-1 text-ui text-content-secondary">
            {t('还没选模型。从上游拉一份清单来勾选。')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {models.map((model) => (
              <ModelChip
                key={model.id}
                id={model.id}
                dead={deadModels.has(model.id)}
                check={checks[model.id]}
                busy={savingModels}
                {...(test === undefined ? {} : { onTest: () => void runTests([model.id]) })}
                {...(actions.patch === undefined ? {} : { onRemove: () => removeModel(model.id) })}
              />
            ))}
          </div>
        )}
        {failed.length > 0 && (
          <ul
            data-testid="provider-model-failures"
            className="m-0 flex list-none flex-col gap-2 p-0"
          >
            {failed.map((id) => {
              const failure = failureOf(checks[id]);
              const check = checks[id];
              const upstream =
                check?.phase === 'done'
                  ? [
                      check.result.httpStatus === null ? null : `HTTP ${check.result.httpStatus}`,
                      check.result.detail ?? null,
                    ]
                      .filter((part) => part !== null)
                      .join(' · ')
                  : '';
              return (
                <li key={id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-meta">
                  <code className="text-destructive">{id}</code>
                  <span className="text-content-secondary">
                    {failure === 'unavailable' || failure === null
                      ? t('测试没能跑完，请重试。')
                      : t(FAILURE_SENTENCE[failure])}
                  </span>
                  {upstream !== '' && (
                    <span
                      data-testid="provider-model-failure-detail"
                      title={upstream}
                      className="order-last min-w-0 basis-full truncate text-content-tertiary max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]"
                    >
                      {upstream}
                    </span>
                  )}
                  {actions.patch !== undefined && (
                    <Button
                      variant="link"
                      size="xs"
                      className="-my-1 ml-auto h-6 px-1 text-meta pointer-coarse:-my-3 pointer-coarse:h-11"
                      disabled={savingModels}
                      onClick={() => removeModel(id)}
                    >
                      {t('移除')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <SettingsSection title={t('管理')}>
        <SettingsDangerZone
          label={t('移除服务商')}
          description={t('移除后，使用它的模型不再可选。')}
          actionLabel={t('移除')}
          onAction={() => setConfirming(true)}
        />
      </SettingsSection>
      {actions.listUpstream !== undefined && picking && (
        <UpstreamModelPicker
          endpoint={modelsEndpoint(record)}
          selected={ids}
          load={actions.listUpstream}
          onClose={() => setPicking(false)}
          onSave={(next, names) => {
            setPicking(false);
            const byId = new Map(models.map((m) => [m.id, m]));
            const added = next.filter((id) => !byId.has(id));
            void saveModels(
              next.map((id) => byId.get(id) ?? { id, name: names.get(id) ?? id }),
            ).then((saved) => {
              if (saved) void runTests(added);
            });
          }}
        />
      )}
      <AlertDialogShell
        title={t('移除「{name}」？', { name: record.label })}
        ariaLabel={t('移除服务商')}
        open={confirming}
        onClose={() => setConfirming(false)}
        footer={
          <AlertDialogActions
            cancelLabel={t('取消')}
            confirmLabel={t('移除')}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              actions.remove?.();
            }}
          />
        }
      >
        <p className="m-0">{t('移除后，用到它的模型和路由不再可用。')}</p>
      </AlertDialogShell>
    </>
  );
}
