import type { ProviderFailure, UpstreamModelsResult } from '@cairn/shared';
import { cn } from 'cn';
import { CircleAlert, RotateCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { useI18n } from '../i18n/provider.js';

export interface UpstreamOption {
  id: string;
  name: string;
  family?: string;
  costTier?: string;
  costSummary?: string;
  contextTokens?: number;
}

type Load =
  | { phase: 'loading' }
  | { phase: 'ok'; models: UpstreamOption[] }
  | {
      phase: 'fallback';
      models: UpstreamOption[];
      failure: ProviderFailure;
      httpStatus: number | null;
    }
  | {
      phase: 'failed';
      failure: ProviderFailure | 'unavailable';
      httpStatus: number | null;
    };

export const COST_TIER_LABEL: Record<string, string> = {
  'Low cost': '低价',
  'Med cost': '中价',
  'High cost': '高价',
  Free: '免费',
};

const LIST_FAILURE: Record<ProviderFailure | 'unavailable', string> = {
  auth: '上游拒绝了 API key。请检查 API key 后重试。',
  'not-found': '上游没有提供模型清单。',
  'rate-limit': '上游限流了，稍后重试。',
  timeout: '上游 10 秒内未响应。',
  upstream: '上游返回了错误，稍后重试。',
  invalid: '上游返回的不是模型清单。',
  network: '无法连接上游。请检查地址后重试。',
  'no-model': '上游没有提供模型清单。',
  unavailable: '未能获取上游模型，请重试。',
};

const FALLBACK_REASON: Record<ProviderFailure, string> = {
  auth: '上游拒绝了这个订阅的登录，未能获取模型清单。请重新登录后重试。',
  'not-found': '上游未返回模型清单，请稍后重试。',
  'rate-limit': '上游已限流，未能获取模型清单，请稍后重试。',
  timeout: '上游 10 秒内未响应，未能获取模型清单。',
  upstream: '上游未返回模型清单，请稍后重试。',
  invalid: '上游未返回模型清单，请稍后重试。',
  network: '无法连接上游，未能获取模型清单。请检查网络后重试。',
  'no-model': '上游未返回模型清单，请稍后重试。',
};

export function UpstreamModelPicker({
  endpoint,
  selected,
  load,
  groupModels,
  testable = true,
  fallbackReasons,
  onClose,
  onSave,
}: {
  endpoint: string;
  selected: readonly string[];
  load: () => Promise<UpstreamModelsResult>;
  groupModels?: (models: UpstreamOption[]) => [string, UpstreamOption[]][];
  testable?: boolean;
  fallbackReasons?: Partial<Record<ProviderFailure, string>>;
  onClose: () => void;
  onSave: (ids: string[], names: ReadonlyMap<string, string>, base: readonly string[]) => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<Load>({ phase: 'loading' });
  const [draft, setDraft] = useState<string[]>(() => [...selected]);
  const [opened] = useState(() => selected);
  const [initialLoad] = useState(() => load);
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ phase: 'loading' });
    initialLoad().then(
      (result) => {
        if (!live) return;
        setState(
          result.status === 'ok'
            ? { phase: 'ok', models: result.models }
            : result.status === 'fallback'
              ? {
                  phase: 'fallback',
                  models: result.models,
                  failure: result.failure,
                  httpStatus: result.httpStatus,
                }
              : { phase: 'failed', failure: result.failure, httpStatus: result.httpStatus },
        );
      },
      () => {
        if (!live) return;
        setState({
          phase: 'failed',
          failure: 'unavailable',
          httpStatus: null,
        });
      },
    );
    return () => {
      live = false;
    };
  }, [initialLoad, attempt]);

  const listed = state.phase === 'ok' || state.phase === 'fallback';
  const upstream = listed ? state.models : [];
  const names = new Map(upstream.map((model) => [model.id, model.name]));
  const byId = new Map(upstream.map((model) => [model.id, model]));
  const picked = new Set(draft);
  const q = query.trim().toLowerCase();
  const hit = (id: string) => {
    if (q === '') return true;
    const model = byId.get(id);
    return [id, model?.name, model?.family, model?.costTier]
      .filter((part): part is string => part !== undefined)
      .some((part) => part.toLowerCase().includes(q));
  };
  const pickedRows = draft.filter(hit);
  const otherRows = upstream.map((model) => model.id).filter((id) => !picked.has(id) && hit(id));
  const toggle = (id: string) =>
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const addTyped = () => {
    const id = typed.trim();
    if (id === '' || picked.has(id)) return;
    setDraft((prev) => [...prev, id]);
    setTyped('');
  };

  const contextLabel = (tokens: number) =>
    tokens >= 1_000_000
      ? `${Number((tokens / 1_000_000).toFixed(1))}M`
      : `${Math.round(tokens / 1000)}K`;

  const row = (id: string) => {
    const name = names.get(id);
    const model = byId.get(id);
    const checkboxId = `upstream-model-${id}`;
    return (
      <label
        key={id}
        htmlFor={checkboxId}
        data-testid="upstream-model"
        data-model-id={id}
        title={model?.costSummary}
        className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-menu-hover pointer-coarse:min-h-11"
      >
        <Checkbox id={checkboxId} checked={picked.has(id)} onCheckedChange={() => toggle(id)} />
        <span className="flex min-w-0 flex-auto items-baseline gap-2">
          <code className="truncate text-meta text-foreground">{id}</code>
          {name !== undefined && name !== id && (
            <span className="truncate text-meta text-content-tertiary">{name}</span>
          )}
        </span>
        {model?.costTier === 'Free' && (
          <span
            data-testid="upstream-model-free"
            className="flex-none rounded border border-border px-1 text-caption text-content-tertiary"
          >
            {t('免费')}
          </span>
        )}
        {model?.costTier !== undefined && model.costTier !== 'Free' && (
          <span className="flex-none text-caption text-content-tertiary">
            {t(COST_TIER_LABEL[model.costTier] ?? model.costTier)}
          </span>
        )}
        {model?.contextTokens !== undefined && (
          <span className="flex-none text-caption text-content-tertiary tabular-nums">
            {contextLabel(model.contextTokens)}
          </span>
        )}
      </label>
    );
  };

  const retry = (
    <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
      <RotateCw aria-hidden />
      {t('重试')}
    </Button>
  );
  const manualAdd = (
    <div className="flex w-full flex-col gap-1.5 border-t border-border pt-3">
      <span className="text-meta text-content-tertiary">{t('上游不给清单时，按模型 ID 添加')}</span>
      <Input
        aria-label={t('模型 ID')}
        placeholder={t('模型 ID，回车加入')}
        className={cn(FORM_CONTROL_CLS, 'w-full')}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') addTyped();
        }}
      />
    </div>
  );
  const added = draft.filter((id) => !opened.includes(id)).length;
  return (
    <DialogShell
      title={t('从上游选择模型')}
      subtitle={
        <code className="block w-0 min-w-full truncate" title={endpoint}>
          {endpoint}
        </code>
      }
      onClose={onClose}
      size="m"
      footer={
        <>
          <span className="mr-auto text-meta text-content-tertiary">
            {t('已选 {n} 个', { n: draft.length })}
          </span>
          <Button variant="ghost" className={DIALOG_PRIMARY_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            data-testid="upstream-save"
            disabled={draft.length === 0}
            onClick={() => onSave(draft, names, opened)}
          >
            {testable && added > 0 ? t('保存并测试新选的') : t('保存')}
          </Button>
        </>
      }
    >
      {state.phase === 'loading' && (
        <div
          data-testid="upstream-loading"
          className="flex min-h-112 flex-col gap-2"
          aria-busy="true"
        >
          <span className="flex items-center gap-2 text-meta text-content-tertiary">
            <RingSpinner className="size-4" />
            {t('正在获取上游模型')}
          </span>
          {Array.from({ length: 12 }, (_, index) => (
            <Skeleton key={index} className="h-7 bg-secondary ring-1 ring-border ring-inset" />
          ))}
        </div>
      )}
      {state.phase === 'failed' && (
        <div data-testid="upstream-error" className="flex flex-col items-start gap-3">
          <p
            role="alert"
            className="m-0 flex items-start gap-2 text-ui text-content-secondary"
            title={state.httpStatus === null ? undefined : `HTTP ${state.httpStatus}`}
          >
            <CircleAlert aria-hidden className="mt-0.5 size-4 flex-none text-destructive" />
            {t(LIST_FAILURE[state.failure])}
          </p>
          {retry}
          {manualAdd}
          {draft.length > 0 && (
            <div className="flex w-full flex-col">{draft.map((id) => row(id))}</div>
          )}
        </div>
      )}
      {state.phase === 'fallback' && (
        <div data-testid="upstream-fallback" className="mb-3 flex flex-col items-start gap-3">
          <p
            role="alert"
            className="m-0 flex items-start gap-2 text-ui text-content-secondary"
            title={state.httpStatus === null ? undefined : `HTTP ${state.httpStatus}`}
          >
            <CircleAlert aria-hidden className="mt-0.5 size-4 flex-none text-destructive" />
            {t(fallbackReasons?.[state.failure] ?? FALLBACK_REASON[state.failure])}
          </p>
          {retry}
        </div>
      )}
      {listed && (
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-content-tertiary"
            />
            <Input
              aria-label={t('搜索模型')}
              placeholder={t('搜索 {n} 个模型', { n: upstream.length })}
              className={cn(FORM_CONTROL_CLS, 'w-full pl-8')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {state.phase === 'ok' && upstream.length === 0 && (
            <p className="m-0 py-2 text-meta text-content-tertiary">{t('上游返回了空清单。')}</p>
          )}
          {pickedRows.length > 0 && (
            <div className="flex flex-col">
              <span
                data-testid="upstream-group"
                className="px-2 pt-1 pb-1 text-meta text-content-tertiary"
              >
                {t('已选 {n}', { n: draft.length })}
              </span>
              {pickedRows.map(row)}
            </div>
          )}
          {otherRows.length > 0 &&
            (groupModels === undefined || state.phase === 'fallback' ? (
              <div className="flex flex-col">
                <span
                  data-testid="upstream-group"
                  className="px-2 pt-1 pb-1 text-meta text-content-tertiary"
                >
                  {state.phase === 'fallback' ? t('备用清单，不是上游返回的') : t('上游其他')}
                </span>
                {otherRows.map(row)}
              </div>
            ) : (
              groupModels(otherRows.map((id) => byId.get(id) ?? { id, name: id })).map(
                ([group, models]) =>
                  models.length > 0 && (
                    <div key={group} className="flex flex-col">
                      <span
                        data-testid="upstream-group"
                        className="px-2 pt-1 pb-1 text-meta text-content-tertiary"
                      >
                        {t(group)} · {models.length}
                      </span>
                      {models.map((model) => row(model.id))}
                    </div>
                  ),
              )
            ))}
          {upstream.length > 0 && pickedRows.length === 0 && otherRows.length === 0 && (
            <p className="m-0 py-2 text-meta text-content-tertiary">{t('没有匹配的模型')}</p>
          )}
          {state.phase === 'fallback' && manualAdd}
        </div>
      )}
    </DialogShell>
  );
}
