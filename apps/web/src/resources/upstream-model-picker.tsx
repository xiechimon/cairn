import { type ProviderFailure, providerModelSchema } from '@cairn/shared';
import { cn } from 'cn';
import { CircleAlert, RotateCw, Search } from 'lucide-react';
import { Component, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { FieldError } from '../components/ui/field.js';
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

type CatalogResult<Model> =
  | { status: 'ok'; models: Model[] }
  | { status: 'fallback'; models: Model[]; failure: ProviderFailure; httpStatus: number | null }
  | { status: 'failed'; failure: ProviderFailure; httpStatus: number | null };

type CatalogNotice = { attempt: number } & (
  | { status: 'ok'; empty: boolean; omittedCount: number }
  | { status: 'fallback'; failure: ProviderFailure; httpStatus: number | null }
  | { status: 'failed'; failure: ProviderFailure | 'unavailable'; httpStatus: number | null }
);

type ModelRow = Readonly<UpstreamOption>;

export function deriveModelSource(
  hasSuccessfulResponse: boolean,
  inLatestSuccessfulList: boolean,
  everReturned: boolean,
): 'upstream' | 'fallback' | 'missing' {
  if (hasSuccessfulResponse) return inLatestSuccessfulList ? 'upstream' : 'missing';
  return everReturned ? 'fallback' : 'upstream';
}

type ModelSection = Readonly<{
  kind: 'initial' | 'typed' | 'catalog';
  vendor: string | null;
  rows: readonly ModelRow[];
}>;

type PickerState<Model> = {
  draft: string[];
  sections: readonly ModelSection[];
  catalog: ReadonlyMap<string, Model>;
  latestUpstreamIds: ReadonlySet<string> | null;
  notices: readonly CatalogNotice[];
};

type GroupModels = (models: UpstreamOption[]) => [string, UpstreamOption[]][];

function appendCatalog<Model extends UpstreamOption>(
  selection: PickerState<Model>,
  result: Extract<CatalogResult<Model>, { models: Model[] }>,
  groupModels: GroupModels | undefined,
  initialLoad: boolean,
): PickerState<Model> {
  const responseCatalog = new Map(result.models.map((model) => [model.id, model]));
  const catalog = new Map([...selection.catalog, ...responseCatalog]);
  const existing = new Set(selection.sections.flatMap(({ rows }) => rows.map(({ id }) => id)));
  const newModels = [...responseCatalog.values()].filter(({ id }) => !existing.has(id));
  const groups = groupModels?.(newModels) ?? [[null, newModels] as const];
  const sections = initialLoad
    ? selection.sections.map((section) =>
        section.kind === 'initial'
          ? { ...section, rows: section.rows.map((row) => responseCatalog.get(row.id) ?? row) }
          : section,
      )
    : selection.sections;
  return {
    ...selection,
    catalog,
    latestUpstreamIds:
      result.status === 'ok' ? new Set(responseCatalog.keys()) : selection.latestUpstreamIds,
    sections: [
      ...sections,
      ...groups.flatMap<ModelSection>(([vendor, rows]) =>
        rows.length === 0 ? [] : [{ kind: 'catalog', vendor, rows }],
      ),
    ],
  };
}

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

function ModelOptionRow({
  model,
  source,
  checked,
  onToggle,
}: {
  model: ModelRow;
  source: ReturnType<typeof deriveModelSource>;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const { id, name, costTier, costSummary, contextTokens } = model;
  const checkboxId = useId();
  const provenanceId = `${checkboxId}-source`;
  const provenance =
    source === 'fallback'
      ? t('备用清单，不是上游返回的')
      : source === 'missing'
        ? t('不在最新列表')
        : undefined;
  return (
    <label
      htmlFor={checkboxId}
      data-testid="upstream-model"
      data-model-id={id}
      data-model-source={source}
      title={costSummary}
      className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md px-2 py-1 hover:bg-menu-hover"
    >
      <Checkbox
        id={checkboxId}
        className="after:content-none"
        checked={checked}
        onCheckedChange={onToggle}
        aria-describedby={provenance === undefined ? undefined : provenanceId}
      />
      <span className="flex min-w-0 flex-auto flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <code className="truncate text-meta text-foreground">{id}</code>
          {name !== id && <span className="truncate text-meta text-content-tertiary">{name}</span>}
        </span>
        <span
          id={provenanceId}
          data-testid="upstream-provenance"
          aria-hidden="true"
          title={provenance}
          className="block h-lh w-0 min-w-full shrink-0 truncate text-meta text-content-tertiary"
        >
          {provenance}
        </span>
      </span>
      {costTier === 'Free' && (
        <span
          data-testid="upstream-model-free"
          className="flex-none rounded border border-border px-1 text-caption text-content-tertiary"
        >
          {t('免费')}
        </span>
      )}
      {costTier !== undefined && costTier !== 'Free' && (
        <span className="min-w-0 truncate text-caption text-content-tertiary">
          {t(COST_TIER_LABEL[costTier] ?? costTier)}
        </span>
      )}
      {contextTokens !== undefined && (
        <span className="flex-none text-caption text-content-tertiary tabular-nums">
          {contextTokens >= 1_000_000
            ? `${Number((contextTokens / 1_000_000).toFixed(1))}M`
            : `${Math.round(contextTokens / 1000)}K`}
        </span>
      )}
    </label>
  );
}

const MODEL_ROW = '[data-testid="upstream-model"]';

type ScrollAnchor = { scroller: HTMLDivElement; anchor: HTMLElement; top: number };

class PickerBody extends Component<
  { children: ReactNode },
  Record<string, never>,
  ScrollAnchor | null
> {
  private body: HTMLDivElement | null = null;
  private pointer: { id: number; x: number; y: number } | null = null;

  private trackPointer = ({ pointerId: id, clientX: x, clientY: y }: PointerEvent) => {
    this.pointer = { id, x, y };
  };

  private forgetPointer = ({ pointerId }: PointerEvent) => {
    if (this.pointer?.id === pointerId) this.pointer = null;
  };

  private endTouch = (event: PointerEvent) => {
    if (event.pointerType === 'touch') this.forgetPointer(event);
  };

  private watchPointer = (body: HTMLDivElement | null) => {
    this.body = body;
    if (!body) return;
    const doc = body.ownerDocument;
    const track = ['pointerenter', 'pointermove', 'pointerdown'] as const;
    for (const name of track) body.addEventListener(name, this.trackPointer);
    body.addEventListener('pointerleave', this.forgetPointer);
    doc.addEventListener('pointercancel', this.forgetPointer, true);
    doc.addEventListener('pointerup', this.endTouch, true);
    return () => {
      for (const name of track) body.removeEventListener(name, this.trackPointer);
      body.removeEventListener('pointerleave', this.forgetPointer);
      doc.removeEventListener('pointercancel', this.forgetPointer, true);
      doc.removeEventListener('pointerup', this.endTouch, true);
      this.body = null;
      this.pointer = null;
    };
  };

  getSnapshotBeforeUpdate(): ScrollAnchor | null {
    const scroller = this.body?.closest<HTMLDivElement>('[data-testid="dialog-body"]');
    if (!scroller) return null;
    const doc = scroller.ownerDocument;
    const pointed = this.pointer && doc.elementFromPoint(this.pointer.x, this.pointer.y);
    const focused = doc.activeElement;
    const viewport = scroller.getBoundingClientRect();
    const candidates = [
      pointed?.closest<HTMLElement>(MODEL_ROW),
      focused?.closest<HTMLElement>(MODEL_ROW),
    ];
    for (const anchor of candidates) {
      if (!anchor || !scroller.contains(anchor)) continue;
      const { top, bottom } = anchor.getBoundingClientRect();
      if (top < viewport.bottom && bottom > viewport.top) return { scroller, anchor, top };
    }
    return null;
  }

  componentDidUpdate(
    _props: { children: ReactNode },
    _state: unknown,
    snapshot: ScrollAnchor | null,
  ) {
    if (!snapshot) return;
    const { scroller, anchor, top } = snapshot;
    if (!scroller.contains(anchor)) return;
    const delta = anchor.getBoundingClientRect().top - top;
    if (delta !== 0) scroller.scrollTop += delta;
  }

  render() {
    return (
      <div ref={this.watchPointer} className="flex flex-col gap-2">
        {this.props.children}
      </div>
    );
  }
}

export function UpstreamModelPicker<Model extends UpstreamOption = UpstreamOption>({
  endpoint,
  selected,
  load,
  groupModels,
  modelIdSchema = providerModelSchema.shape.id,
  testable = true,
  fallbackReasons,
  opener,
  onClose,
  onSave,
}: {
  endpoint: string;
  selected: readonly string[];
  load: () => Promise<CatalogResult<Model>>;
  groupModels?: GroupModels;
  modelIdSchema?: Pick<typeof providerModelSchema.shape.id, 'safeParse'>;
  testable?: boolean;
  fallbackReasons?: Partial<Record<ProviderFailure, string>>;
  opener?: HTMLButtonElement;
  onClose: () => void;
  onSave: (ids: string[], catalog: ReadonlyMap<string, Model>, base: readonly string[]) => void;
}) {
  const { locale, t } = useI18n();
  const [state, setState] = useState<PickerState<Model>>(() => {
    const draft = [...new Set(selected)];
    const rows: ModelRow[] = draft.map((id) => ({ id, name: id }));
    return {
      draft,
      sections: rows.length === 0 ? [] : [{ kind: 'initial', vendor: null, rows }],
      catalog: new Map(),
      latestUpstreamIds: null,
      notices: [],
    };
  });
  const [opening] = useState(() => ({
    load,
    groupModels,
    base: [...selected],
    selected: new Set(selected),
  }));
  const [typed, setTyped] = useState('');
  const typedErrorId = useId();
  const typedId = typed.trim();
  const typedInvalid = typedId !== '' && !modelIdSchema.safeParse(typedId).success;
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let live = true;
    const settle = (
      result: CatalogResult<Model> | { status: 'failed'; failure: 'unavailable'; httpStatus: null },
    ) => {
      if (!live) return;
      setState((previous) => {
        const next =
          result.status === 'failed'
            ? previous
            : appendCatalog(previous, result, opening.groupModels, attempt === 0);
        if (result.status !== 'ok') {
          const { status, failure, httpStatus } = result;
          const notice: CatalogNotice =
            status === 'fallback'
              ? { attempt, status, failure, httpStatus }
              : { attempt, status, failure, httpStatus };
          return { ...next, notices: [...previous.notices, notice] };
        }
        const empty = result.models.length === 0;
        if (attempt === 0 && !empty) return next;
        const omittedCount = next.sections.reduce(
          (count, { rows }) =>
            count + rows.filter(({ id }) => !next.latestUpstreamIds?.has(id)).length,
          0,
        );
        return {
          ...next,
          notices: [...previous.notices, { attempt, status: 'ok', empty, omittedCount }],
        };
      });
      setPending(false);
    };
    opening
      .load()
      .then(settle, () => settle({ status: 'failed', failure: 'unavailable', httpStatus: null }));
    return () => {
      live = false;
    };
  }, [opening, attempt]);

  const { draft, sections, catalog, latestUpstreamIds, notices } = state;
  const picked = new Set(draft);
  const toggle = (id: string) =>
    setState((previous) => ({
      ...previous,
      draft: previous.draft.includes(id)
        ? previous.draft.filter((selectedId) => selectedId !== id)
        : [...previous.draft, id],
    }));
  const addTyped = () => {
    const id = typedId;
    if (id === '' || typedInvalid) return;
    setState((previous) => {
      if (previous.draft.includes(id)) return previous;
      return {
        ...previous,
        draft: [...previous.draft, id],
        sections: previous.sections.some(({ rows }) => rows.some((row) => row.id === id))
          ? previous.sections
          : [...previous.sections, { kind: 'typed', vendor: null, rows: [{ id, name: id }] }],
      };
    });
    setTyped('');
  };

  const number = new Intl.NumberFormat(locale);
  const saveIds =
    typedId !== '' && !typedInvalid && !draft.includes(typedId) ? [...draft, typedId] : draft;
  const added = saveIds.some((id) => !opening.selected.has(id));
  const initialLoading = attempt === 0 && pending;
  const canRetry = notices.some(({ status }) => status !== 'ok');
  const filter = query.trim().toLowerCase();
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
      className="h-144"
      initialFocus={searchRef}
      {...(opener === undefined ? {} : { returnFocusTo: opener })}
      footer={
        <>
          <span className="mr-auto text-meta text-content-tertiary tabular-nums">
            {t('已选 {n} 个', { n: draft.length })}
          </span>
          <Button variant="ghost" className={DIALOG_PRIMARY_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            data-testid="upstream-save"
            disabled={draft.length === 0 && typedInvalid}
            onClick={() => onSave(saveIds, catalog, opening.base)}
          >
            {testable && added ? t('保存并测试新选的') : t('保存')}
          </Button>
        </>
      }
    >
      <PickerBody>
        <div className="relative flex-none">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-content-tertiary"
          />
          <Input
            ref={searchRef}
            aria-label={t('搜索模型')}
            placeholder={t('搜索模型')}
            className={cn(FORM_CONTROL_CLS, 'w-full pl-8')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="min-h-40" aria-busy={initialLoading || undefined}>
          {!initialLoading && filter !== '' && (
            <p className="m-0 hidden py-2 text-meta text-content-tertiary only:block">
              {t('没有匹配的模型')}
            </p>
          )}
          {sections.map(({ kind, vendor, rows }) => {
            const visible =
              filter === ''
                ? rows
                : rows.filter(({ id, name, family, costTier }) =>
                    [id, name, family, costTier].some((part) =>
                      part?.toLowerCase().includes(filter),
                    ),
                  );
            if (visible.length === 0) return null;
            const heading =
              kind === 'initial'
                ? t('打开时已选')
                : vendor !== null
                  ? `${t(vendor)} · ${visible.length}`
                  : t('上游其他');
            return (
              <div key={rows[0]?.id} className="flex flex-col">
                {kind !== 'typed' && (
                  <span
                    data-testid="upstream-group"
                    className="block min-h-12 truncate px-2 py-1 text-meta text-content-tertiary tabular-nums"
                    title={heading}
                  >
                    {heading}
                  </span>
                )}
                {visible.map((model) => (
                  <ModelOptionRow
                    key={model.id}
                    model={model}
                    source={deriveModelSource(
                      latestUpstreamIds !== null,
                      latestUpstreamIds?.has(model.id) ?? false,
                      catalog.has(model.id),
                    )}
                    checked={picked.has(model.id)}
                    onToggle={() => toggle(model.id)}
                  />
                ))}
              </div>
            );
          })}
          {initialLoading && (
            <div data-testid="upstream-loading">
              <span className="flex min-h-12 items-start gap-2 px-2 py-1 text-meta text-content-tertiary">
                <RingSpinner className="size-4 shrink-0" />
                {t('正在获取上游模型')}
              </span>
              <Skeleton className="h-12 bg-secondary ring-1 ring-border ring-inset" />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex w-full flex-none flex-col gap-1.5 border-t border-border pt-3">
            <span className="text-meta text-content-tertiary">{t('输入模型 ID，按回车添加')}</span>
            <div className="flex items-center gap-2">
              <Input
                aria-label={t('模型 ID')}
                placeholder={t('模型 ID')}
                aria-invalid={typedInvalid || undefined}
                aria-describedby={typedInvalid ? typedErrorId : undefined}
                className={cn(FORM_CONTROL_CLS, 'min-w-0 flex-1')}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addTyped();
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="upstream-add-typed"
                disabled={typedId === '' || typedInvalid}
                onClick={addTyped}
              >
                {t('添加')}
              </Button>
            </div>
            {typedInvalid && (
              <FieldError id={typedErrorId}>{t('请输入服务商提供的有效模型 ID。')}</FieldError>
            )}
          </div>
          {canRetry && (
            <Button
              variant="outline"
              size="sm"
              className="flex-none self-start"
              aria-busy={pending}
              disabled={pending}
              onClick={() => {
                setPending(true);
                setAttempt((n) => n + 1);
              }}
            >
              <RotateCw aria-hidden className={pending ? 'motion-safe:animate-spin' : undefined} />
              {t('重试')}
            </Button>
          )}
          <div>
            {notices.map((notice) =>
              notice.status === 'ok' ? (
                <p
                  key={notice.attempt}
                  role="status"
                  className="m-0 py-2 text-meta text-content-tertiary"
                >
                  <span>{notice.empty ? t('上游返回了空清单。') : t('已获取上游模型清单。')}</span>
                  <span className="block wrap-anywhere tabular-nums">
                    {t('第 {attempt} 次刷新：上游清单未列出 {n} 个模型', {
                      attempt: number.format(notice.attempt),
                      n: number.format(notice.omittedCount),
                    })}
                  </span>
                </p>
              ) : (
                <div
                  key={notice.attempt}
                  data-testid={
                    notice.status === 'fallback' ? 'upstream-fallback' : 'upstream-error'
                  }
                  className="flex flex-col items-start gap-1"
                >
                  <p
                    role="alert"
                    className="m-0 flex items-start gap-2 text-ui text-content-secondary"
                    title={notice.httpStatus === null ? undefined : `HTTP ${notice.httpStatus}`}
                  >
                    <CircleAlert aria-hidden className="mt-0.5 size-4 flex-none text-destructive" />
                    {notice.status === 'fallback'
                      ? t(fallbackReasons?.[notice.failure] ?? FALLBACK_REASON[notice.failure])
                      : t(LIST_FAILURE[notice.failure])}
                  </p>
                  <p className="m-0 wrap-anywhere text-meta text-content-tertiary tabular-nums">
                    {notice.status === 'fallback'
                      ? t('第 {attempt} 次刷新：使用备用清单', {
                          attempt: number.format(notice.attempt),
                        })
                      : t('第 {attempt} 次刷新：未能获取上游清单', {
                          attempt: number.format(notice.attempt),
                        })}
                  </p>
                </div>
              ),
            )}
          </div>
        </div>
      </PickerBody>
    </DialogShell>
  );
}
