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
import { keepNewerProvider } from '../api/provider-freshness.js';
import { relativeTime } from '../board/rel-time.js';
import { AnthropicMark } from '../components/brand-marks.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { withCodeSpans } from '../components/notice-banner.js';
import {
  ProviderEditorHead,
  type ProviderMark,
  type ProviderTone,
  TONE_DOT,
} from '../components/providers/provider-panel.js';
import { SettingsDangerZone, SettingsSection } from '../components/settings-list.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Popover, PopoverContent } from '../components/ui/popover.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import { useI18n } from '../i18n/provider.js';
import {
  dropModelCheck,
  type ModelCheck,
  type ModelChecks,
  recordModelResult,
  retireModelChecks,
  selectVisibleChecks,
  startModelChecks,
} from './provider-check-state.js';
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

export function Field({ label, children }: { label: string; children: ReactNode }) {
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
  ) => Promise<ProviderRecord>;
  latest?: () => ProviderRecord | undefined;
  test?: (model: string) => Promise<ProviderTestResult>;
  listUpstream?: () => Promise<UpstreamModelsResult>;
  onUpdateRuntime?: () => void;
  updatingRuntime?: boolean;
  remove?: () => void;
}

export const FAILURE_SHORT: Record<ProviderFailure, string> = {
  auth: 'API key 无效',
  'not-found': '模型不存在',
  'rate-limit': '限流',
  timeout: '超时',
  upstream: '上游出错',
  invalid: '响应异常',
  network: '无法连接',
  'no-model': '没有模型',
};

export const FAILURE_SENTENCE: Record<ProviderFailure, string> = {
  auth: 'API key 无效或没有这个模型的权限',
  'not-found': '上游没有这个模型',
  'rate-limit': '上游限流了，稍后再测',
  timeout: '10 秒内未响应',
  upstream: '上游返回了错误',
  invalid: '上游返回的内容不像模型回复',
  network: '无法连接上游，请检查地址',
  'no-model': '没有可测的模型',
};

const TEST_CONCURRENCY = 3;

const UNFINISHED_SENTENCE = '测试未能完成，请重试';

export function failureOf(check: ModelCheck | undefined): ProviderFailure | 'unavailable' | null {
  if (check?.phase === 'unavailable') return 'unavailable';
  if (check?.phase === 'done' && check.result.status === 'failed') {
    return check.result.failure ?? 'upstream';
  }
  return null;
}

export interface CheckFact {
  label: string;
  value: string;
  code?: boolean;
}

export function CheckResultPopover({
  anchor,
  open,
  onClose,
  tone,
  sentence,
  detail,
  testId,
  detailTestId,
  phase,
}: {
  anchor: Element | null;
  open: boolean;
  onClose: () => void;
  tone: Extract<ProviderTone, 'ok' | 'fail' | 'off'> | 'checking';
  sentence: ReactNode;
  detail: readonly CheckFact[] | null;
  testId: string;
  detailTestId?: string;
  phase?: string;
}) {
  if (anchor === null) return null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <PopoverContent
        anchor={anchor}
        align="end"
        sideOffset={8}
        initialFocus={false}
        finalFocus={false}
        collisionPadding={12}
        data-testid={testId}
        data-phase={
          phase ?? (tone === 'checking' ? 'checking' : tone === 'ok' ? 'passed' : 'failed')
        }
        className="w-96 max-w-[calc(100vw-24px)] gap-2 p-3"
      >
        <div role="status" className="flex flex-col gap-2">
          <span
            className={cn(
              'flex items-start gap-1.5 text-ui font-medium',
              tone === 'fail' ? 'text-destructive' : 'text-foreground',
            )}
          >
            {tone === 'checking' ? (
              <RingSpinner aria-hidden className="mt-0.5 size-4 flex-none text-content-tertiary" />
            ) : (
              <span
                aria-hidden
                className={cn('mt-2 size-1.5 flex-none rounded-full', TONE_DOT[tone])}
              />
            )}
            <span>{sentence}</span>
          </span>
          {detail !== null && detail.length > 0 && (
            <dl
              data-testid={detailTestId}
              className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-border pt-2.5 text-meta"
            >
              {detail.map((fact) => (
                <div key={`${fact.label}/${fact.value}`} className="contents">
                  <dt
                    className={cn(
                      'text-content-secondary',
                      fact.code === true && 'font-mono text-caption leading-5',
                    )}
                  >
                    {fact.label}
                  </dt>
                  <dd
                    className={cn(
                      'm-0 text-foreground tabular-nums [overflow-wrap:anywhere]',
                      fact.code === true && 'font-mono text-caption leading-5',
                    )}
                  >
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ModelReport {
  ids: readonly string[];
  anchor: Element | null;
  open: boolean;
}

interface ModelTestState {
  fingerprint: string | undefined;
  checks: ModelChecks;
  report: ModelReport | null;
}

export function useModelTests(
  test: ((model: string) => Promise<ProviderTestResult>) | undefined,
  concurrency: number,
  configuration?: { fingerprint: string | undefined },
) {
  const currentFingerprint = configuration?.fingerprint;
  const [{ fingerprint, checks, report }, setState] = useState<ModelTestState>({
    fingerprint: currentFingerprint,
    checks: new Map(),
    report: null,
  });
  if (fingerprint !== currentFingerprint) {
    const remaining = retireModelChecks(checks, fingerprint);
    setState({
      fingerprint: currentFingerprint,
      checks: remaining,
      report:
        remaining === checks ||
        report?.ids.some((id) =>
          [...remaining.values()].some((models) => Object.hasOwn(models, id)),
        )
          ? report
          : null,
    });
  }
  const resetEpoch = useRef(0);
  const reset = () => {
    resetEpoch.current += 1;
    setState({ fingerprint: currentFingerprint, checks: new Map(), report: null });
  };
  const run = async (
    ids: readonly string[],
    anchor: Element | null,
    testModels = test,
    configurationFingerprint = configuration?.fingerprint,
  ) => {
    if (testModels === undefined || ids.length === 0) return;
    const started = resetEpoch.current;
    const pending = { phase: 'running' } as const;
    setState((prev) => ({
      ...prev,
      report: { ids, anchor, open: true },
      checks: startModelChecks(
        prev.checks,
        configurationFingerprint,
        Object.fromEntries(ids.map((id) => [id, pending])),
      ),
    }));
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const model = id;
        const outcome: Exclude<ModelCheck, { phase: 'running' }> = await testModels(model).then(
          (result) => ({ phase: 'done', result, at: Date.now() }),
          () => ({ phase: 'unavailable', at: Date.now() }),
        );
        if (resetEpoch.current === started) {
          setState((prev) => ({
            ...prev,
            checks: recordModelResult(
              prev.checks,
              configurationFingerprint,
              model,
              pending,
              outcome,
              configuration !== undefined,
            ),
          }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    if (resetEpoch.current === started) {
      setState((prev) =>
        prev.report?.ids === ids ? { ...prev, report: { ...prev.report, open: true } } : prev,
      );
    }
  };
  const drop = (id: string) => {
    setState((prev) => ({
      ...prev,
      checks: dropModelCheck(prev.checks, id),
      report: prev.report?.ids.includes(id) ? null : prev.report,
    }));
  };
  const close = () =>
    setState((prev) =>
      prev.report === null ? prev : { ...prev, report: { ...prev.report, open: false } },
    );
  const visible = selectVisibleChecks(checks, currentFingerprint);
  const visibleReport =
    report?.ids.some((id) => Object.hasOwn(visible, id)) === true ? report : null;
  return { checks: visible, report: visibleReport, run, reset, drop, close };
}

export function ModelTestReport({
  report,
  checks,
  failureSentence,
  failureShort = FAILURE_SHORT,
  onClose,
}: {
  report: ModelReport | null;
  checks: Record<string, ModelCheck>;
  failureSentence: Record<ProviderFailure, string>;
  failureShort?: Record<ProviderFailure, string>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (report === null) return null;
  const pending = report.ids.filter((id) => checks[id]?.phase === 'running').length;
  if (pending > 0) {
    return (
      <CheckResultPopover
        anchor={report.anchor}
        open={report.open}
        onClose={onClose}
        tone="checking"
        sentence={
          report.ids.length === 1
            ? t('正在测试 {id}…', { id: report.ids[0] ?? '' })
            : t('正在测试 {done}/{n} 个模型…', {
                done: report.ids.length - pending,
                n: report.ids.length,
              })
        }
        detail={null}
        testId="model-test-result"
      />
    );
  }
  const done = report.ids.flatMap((id) => {
    const check = checks[id];
    return check === undefined || check.phase === 'running' ? [] : [{ id, check }];
  });
  if (done.length === 0) return null;
  const failures = done.flatMap(({ id, check }) => {
    const failure = failureOf(check);
    return failure === null ? [] : [{ id, failure }];
  });
  const reasonOf = (failure: ProviderFailure | 'unavailable') =>
    t(failure === 'unavailable' ? UNFINISHED_SENTENCE : failureSentence[failure]).replace(
      /[。.]$/,
      '',
    );
  const kinds = new Set(failures.map(({ failure }) => failure));
  const [first] = failures;
  const sentence =
    first === undefined
      ? done.length === 1
        ? t('{id} 回复了，能用。', { id: done[0]?.id ?? '' })
        : t('{n} 个模型都回复了，能用。', { n: done.length })
      : done.length === 1
        ? t('{id} 未能连接：{reason}。', { id: first.id, reason: reasonOf(first.failure) })
        : kinds.size === 1
          ? t('{failed}/{n} 个模型未能连接：{reason}。', {
              failed: failures.length,
              n: done.length,
              reason: reasonOf(first.failure),
            })
          : t('{failed}/{n} 个模型未能连接，按每行的原因处理后重新测试。', {
              failed: failures.length,
              n: done.length,
            });
  const now = Date.now();
  const detail = done.map(({ id, check }): CheckFact => {
    const failure = failureOf(check);
    const outcome =
      failure === null
        ? `${t('通过')} · ${check.phase === 'done' ? (check.result.latencyMs ?? 0) : 0} ms`
        : failure === 'unavailable'
          ? t('测试未完成')
          : t('未通过 · {reason}', { reason: t(failureShort[failure]) });
    return { label: id, value: `${outcome} · ${relativeTime(check.at, now, t)}`, code: true };
  });
  return (
    <CheckResultPopover
      anchor={report.anchor}
      open={report.open}
      onClose={onClose}
      tone={first === undefined ? 'ok' : 'fail'}
      phase={first === undefined ? 'passed' : 'failed'}
      sentence={withCodeSpans(sentence)}
      detail={detail}
      testId="model-test-result"
      detailTestId="model-test-detail"
    />
  );
}

export function ModelChip({
  id,
  dead,
  check,
  busy,
  meta,
  testId = 'provider-model',
  onTest,
  onRemove,
}: {
  id: string;
  dead: boolean;
  meta?: ReactNode;
  testId?: string;
  check: ModelCheck | undefined;
  busy: boolean;
  onTest?: (anchor: Element) => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  const failure = failureOf(check);
  const running = check?.phase === 'running';
  return (
    <span
      data-testid={testId}
      data-model-id={id}
      data-liveness={dead ? 'dead' : 'alive'}
      data-check={
        check === undefined ? 'none' : running ? check.phase : failure === null ? 'ok' : 'failed'
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
      {meta}
      {dead && <span className="flex-none text-meta text-content-tertiary">{t('已下架')}</span>}
      {onTest !== undefined && (
        <IconTooltip
          label={t('测试 {name}', { name: id })}
          trigger={
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-content-tertiary"
              disabled={running}
              onClick={(event) => onTest(event.currentTarget)}
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
  runtimeUpdate,
  actions,
}: {
  record: ProviderRecord;
  deadModels: ReadonlySet<string>;
  runtimeUpdate?: {
    installedVersion: string | null;
    availableVersion: string | null;
    phase: 'idle' | 'updating' | 'failed';
  } | null;
  actions: ProviderEditActions;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [picker, setPicker] = useState<{ opener?: HTMLButtonElement } | null>(null);
  const [models, setModels] = useState(record.models);
  const [savedModels, setSavedModels] = useState(record.models);
  const [savingModels, setSavingModels] = useState(false);
  const modelEdits = useRef<{
    saved: ProviderRecord | null;
    pending: number;
    tail: Promise<void>;
  }>({ saved: null, pending: 0, tail: Promise.resolve() });
  const newest = useRef(record);
  const cached = keepNewerProvider(newest.current, record);
  newest.current =
    modelEdits.current.saved === null
      ? cached
      : keepNewerProvider(cached, modelEdits.current.saved);
  const test = actions.test;
  const fingerprint = newest.current.configurationFingerprint;
  const tests = useModelTests(test, TEST_CONCURRENCY, { fingerprint });
  const { checks } = tests;
  const testAllRef = useRef<HTMLButtonElement>(null);
  if (savedModels !== newest.current.models) {
    setSavedModels(newest.current.models);
    if (!savingModels) setModels(newest.current.models);
  }
  const oauth = isOAuthPreset(record.providerId);
  const fire = (body: Parameters<NonNullable<ProviderEditActions['patch']>>[0]) => {
    const reconnect = body.baseUrl !== undefined || body.apiKey !== undefined;
    void actions.patch?.(body).then(
      (saved) => {
        if (reconnect && saved.configurationFingerprint === undefined) tests.reset();
      },
      () => undefined,
    );
  };
  const saveModels = (edit: (saved: ProviderRecord['models']) => ProviderRecord['models']) => {
    const patch = actions.patch;
    if (patch === undefined) return Promise.resolve(undefined);
    const queue = modelEdits.current;
    queue.pending += 1;
    setSavingModels(true);
    const pending = queue.tail.then(async () => {
      const freshest = () =>
        keepNewerProvider(actions.latest?.() ?? newest.current, newest.current);
      const base = freshest();
      const next = edit(base.models);
      setModels(next);
      try {
        const response = await patch({ models: next });
        const saved = keepNewerProvider(freshest(), response);
        newest.current = saved;
        queue.saved = saved;
        setModels(saved.models);
        return saved;
      } catch {
        setModels(newest.current.models);
        return undefined;
      } finally {
        queue.pending -= 1;
        setSavingModels(queue.pending > 0);
      }
    });
    queue.tail = pending.then(() => undefined);
    return pending;
  };
  const removeModel = (id: string) => {
    void saveModels((saved) => saved.filter((model) => model.id !== id));
    tests.drop(id);
  };
  const ids = models.map((m) => m.id);
  const running = ids.filter((id) => checks[id]?.phase === 'running').length;
  const retired = models.filter((model) => deadModels.has(model.id)).length;
  const summary =
    ids.length === 0
      ? null
      : [
          t('{n} 个', { n: ids.length }),
          ...(retired === 0 ? [] : [`${t('已下架')} · ${t('{n} 个模型', { n: retired })}`]),
        ].join(' · ');
  const runtimeUpdating = actions.updatingRuntime === true || runtimeUpdate?.phase === 'updating';
  const showRuntimeUpdate =
    actions.onUpdateRuntime !== undefined &&
    runtimeUpdate != null &&
    (runtimeUpdate.availableVersion !== null ||
      runtimeUpdating ||
      runtimeUpdate.phase === 'failed');
  return (
    <>
      <ProviderEditorHead
        Mark={providerMark(record)}
        name={record.label}
        version={runtimeUpdate?.installedVersion ?? null}
        kind={t(providerKind(record))}
        aside={
          showRuntimeUpdate && (
            <Button
              variant="outline"
              size="sm"
              data-testid="runtime-update"
              disabled={runtimeUpdating}
              aria-label={
                runtimeUpdate.availableVersion !== null
                  ? t('更新到 {version}', { version: `v${runtimeUpdate.availableVersion}` })
                  : t('更新')
              }
              onClick={actions.onUpdateRuntime}
            >
              {runtimeUpdating ? t('更新中…') : t('更新')}
            </Button>
          )
        }
      />
      {showRuntimeUpdate && (
        <p
          data-testid="runtime-update-status"
          className={cn(
            '-mt-3 m-0 text-meta tabular-nums',
            runtimeUpdate.phase === 'failed' ? 'text-destructive' : 'text-content-tertiary',
          )}
        >
          {runtimeUpdating
            ? t('正在后台下载并验证新版本，运行中的会话不受影响。')
            : runtimeUpdate.phase === 'failed'
              ? t('更新未能通过验证，仍在使用当前版本。')
              : t('有新版本 v{version} 可用', { version: runtimeUpdate.availableVersion ?? '' })}
        </p>
      )}
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
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => setPicker({ opener: event.currentTarget })}
              >
                <Download aria-hidden />
                {t('从上游选择')}
              </Button>
            )}
            {test !== undefined && (
              <Button
                variant="outline"
                size="sm"
                ref={testAllRef}
                data-testid="provider-test-all"
                className="min-w-24"
                disabled={running > 0 || ids.length === 0}
                onClick={() => void tests.run(ids, testAllRef.current)}
              >
                <Play aria-hidden />
                {t('全部测试')}
              </Button>
            )}
          </span>
        </div>
        {ids.length === 0 ? (
          <p className="m-0 py-1 text-ui text-content-secondary">
            {t('尚未选择模型。从上游获取模型清单后勾选。')}
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
                {...(test === undefined
                  ? {}
                  : { onTest: (anchor: Element) => void tests.run([model.id], anchor) })}
                {...(actions.patch === undefined ? {} : { onRemove: () => removeModel(model.id) })}
              />
            ))}
          </div>
        )}
        <ModelTestReport
          report={tests.report}
          checks={checks}
          failureSentence={FAILURE_SENTENCE}
          onClose={tests.close}
        />
      </section>
      <SettingsSection title={t('管理')}>
        <SettingsDangerZone
          label={t('移除服务商')}
          description={t('移除后，使用它的模型不再可选。')}
          actionLabel={t('移除')}
          onAction={() => setConfirming(true)}
        />
      </SettingsSection>
      {actions.listUpstream !== undefined && picker !== null && (
        <UpstreamModelPicker
          endpoint={modelsEndpoint(record)}
          selected={ids}
          load={actions.listUpstream}
          {...(picker.opener === undefined ? {} : { opener: picker.opener })}
          onClose={() => setPicker(null)}
          onSave={(next, catalog, base) => {
            setPicker(null);
            const baseIds = new Set(base);
            const picked = new Set(next);
            const added = next.filter((id) => !baseIds.has(id));
            void saveModels((saved) => {
              const byId = new Map(saved.map((model) => [model.id, model]));
              const nextModels = next.flatMap((id) => {
                const existing = byId.get(id);
                if (existing !== undefined) {
                  return [{ ...existing, id, name: catalog.get(id)?.name ?? existing.name }];
                }
                if (baseIds.has(id)) return [];
                return [{ id, name: catalog.get(id)?.name ?? id }];
              });
              const external = saved.filter(
                (model) => !baseIds.has(model.id) && !picked.has(model.id),
              );
              if (external.length === 0) return nextModels;
              const lastSavedIndex = nextModels.findLastIndex((model) => byId.has(model.id));
              return [
                ...nextModels.slice(0, lastSavedIndex + 1),
                ...external,
                ...nextModels.slice(lastSavedIndex + 1),
              ];
            }).then((saved) => {
              if (saved !== undefined && test !== undefined)
                void tests.run(added, testAllRef.current, test, saved.configurationFingerprint);
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
