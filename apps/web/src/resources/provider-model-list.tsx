import type { ProviderModel } from '@cairn/shared';
import { cn } from 'cn';
import { useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { Input } from '../components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { useI18n } from '../i18n/provider.js';
import { PlusSmall, Search, X } from '../icons/index.js';

const FILTER_THRESHOLD = 8;

const ROW_CLS =
  'grid h-8 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2 hover:bg-secondary/60';

const MUTED_ID_CLS = 'truncate font-mono text-caption text-content-tertiary';

const CONTEXT_CLS = 'text-caption text-content-tertiary tabular-nums';

export function contextWindowLabel(tokens: number | undefined): string {
  if (tokens === undefined) return '';
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  return `${Math.round(tokens / 1000)}K`;
}

function matches(model: ProviderModel, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || model.id.toLowerCase().includes(q) || model.name.toLowerCase().includes(q);
}

function ModelLabel({ model }: { model: ProviderModel }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="flex-none truncate text-ui text-foreground">{model.name}</span>
      {model.name !== model.id && <code className={MUTED_ID_CLS}>{model.id}</code>}
    </span>
  );
}

function CustomModelInput({
  existing,
  onAdd,
  onCancel,
}: {
  existing: ReadonlySet<string>;
  onAdd: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const id = value.trim();
  const duplicate = existing.has(id);
  const add = () => {
    if (id === '' || duplicate) return;
    onAdd(id);
    setValue('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          autoFocus
          aria-label={t('模型 ID')}
          aria-invalid={duplicate}
          className="h-8 flex-1 font-mono text-ui"
          value={value}
          placeholder="claude-sonnet-5"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
        />
        <Button variant="outline" className="h-8" disabled={id === '' || duplicate} onClick={add}>
          {t('添加')}
        </Button>
        <Button variant="ghost" className="h-8 text-content-secondary" onClick={onCancel}>
          {t('取消')}
        </Button>
      </div>
      {duplicate && <p className="m-0 text-meta text-destructive">{t('这个模型已在列表里')}</p>}
    </div>
  );
}

export function ProviderModelChecklist({
  catalog,
  selected,
  onSelectedChange,
  custom,
  onCustomChange,
}: {
  catalog: readonly ProviderModel[];
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  custom: readonly string[];
  onCustomChange: (next: string[]) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const visible = catalog.filter((model) => matches(model, query));
  const allSelected = catalog.length > 0 && catalog.every((model) => selected.has(model.id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelectedChange(next);
  };
  const existing = new Set([...catalog.map((model) => model.id), ...custom]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {catalog.length > FILTER_THRESHOLD && (
          <div className="relative w-56 max-w-full">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-content-tertiary" />
            <Input
              aria-label={t('筛选模型')}
              className="h-7.5 pl-8 text-ui"
              value={query}
              placeholder={t('筛选模型')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}
        {catalog.length > 0 && (
          <>
            <span className="text-meta text-content-tertiary tabular-nums">
              {t('已选 {n} / {total}', {
                n: catalog.filter((model) => selected.has(model.id)).length,
                total: catalog.length,
              })}
            </span>
            <Button
              variant="ghost"
              className="ml-auto h-7 px-2 text-meta text-content-secondary"
              onClick={() =>
                onSelectedChange(allSelected ? new Set() : new Set(catalog.map((m) => m.id)))
              }
            >
              {allSelected ? t('全不选') : t('全选')}
            </Button>
          </>
        )}
      </div>
      {catalog.length > 0 && (
        <div className="-mx-2 max-h-64 overflow-y-auto">
          {visible.length === 0 && (
            <p className="m-0 px-2 py-2 text-meta text-content-tertiary">{t('没有匹配的模型')}</p>
          )}
          {visible.map((model) => {
            const on = selected.has(model.id);
            return (
              // biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component.
              <label key={model.id} className={cn(ROW_CLS, 'cursor-pointer', !on && 'opacity-60')}>
                <Checkbox checked={on} onCheckedChange={(next) => toggle(model.id, next)} />
                <ModelLabel model={model} />
                <span className={CONTEXT_CLS}>{contextWindowLabel(model.contextWindow)}</span>
              </label>
            );
          })}
        </div>
      )}
      {custom.length > 0 && (
        <div className="-mx-2">
          {custom.map((id) => (
            <div key={id} className={ROW_CLS}>
              <span />
              <span className="flex min-w-0 items-baseline gap-2">
                <code className="truncate font-mono text-ui text-foreground">{id}</code>
                <span className="text-caption text-content-tertiary">{t('自定义')}</span>
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('移除模型')}
                className="text-content-tertiary"
                onClick={() => onCustomChange(custom.filter((entry) => entry !== id))}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      )}
      {adding ? (
        <CustomModelInput
          existing={existing}
          onAdd={(id) => onCustomChange([...custom, id])}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div>
          <Button
            variant="ghost"
            className="px-0 text-content-secondary"
            onClick={() => setAdding(true)}
          >
            <PlusSmall />
            {t('添加自定义模型')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ProviderModelChips({
  catalog,
  selected,
  onSelectedChange,
}: {
  catalog: readonly ProviderModel[];
  selected: readonly string[];
  onSelectedChange: (next: string[]) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const byId = new Map(catalog.map((model) => [model.id, model]));
  const picked = new Set(selected);
  const options = catalog.filter((model) => !picked.has(model.id) && matches(model, query));
  const typed = query.trim();
  const canAddTyped = typed !== '' && !byId.has(typed) && !picked.has(typed);
  const add = (id: string) => {
    onSelectedChange([...selected, id]);
    setQuery('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((id) => {
        const model = byId.get(id);
        return (
          <span
            key={id}
            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-secondary pr-1 pl-2.5 text-ui text-foreground ring-1 ring-border"
          >
            <span className="truncate">{model?.name ?? id}</span>
            {model !== undefined && (
              <span className={CONTEXT_CLS}>{contextWindowLabel(model.contextWindow)}</span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('移除模型')}
              className="size-5 text-content-tertiary"
              onClick={() => onSelectedChange(selected.filter((entry) => entry !== id))}
            >
              <X />
            </Button>
          </span>
        );
      })}
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="ghost" className="h-7 px-2 text-content-secondary">
              <PlusSmall />
              {t('添加模型')}
            </Button>
          }
        />
        <PopoverContent align="start" className="w-88 gap-0 p-0">
          <div className="border-b border-border p-1.5">
            <Input
              autoFocus
              aria-label={t('搜索模型或输入 ID')}
              className="h-8 border-0 bg-transparent text-ui shadow-none focus-visible:ring-0 dark:bg-transparent"
              value={query}
              placeholder={t('搜索模型或输入 ID')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const first = options[0];
                if (first !== undefined) add(first.id);
                else if (canAddTyped) add(typed);
              }}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {options.map((model) => (
              <button
                key={model.id}
                type="button"
                className="grid h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left hover:bg-secondary"
                onClick={() => add(model.id)}
              >
                <ModelLabel model={model} />
                <span className={CONTEXT_CLS}>{contextWindowLabel(model.contextWindow)}</span>
              </button>
            ))}
            {canAddTyped && (
              <button
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui text-content-secondary hover:bg-secondary"
                onClick={() => add(typed)}
              >
                <PlusSmall className="size-4" />
                {t('添加自定义模型「{id}」', { id: typed })}
              </button>
            )}
            {options.length === 0 && !canAddTyped && (
              <p className="m-0 px-2 py-2 text-meta text-content-tertiary">{t('没有匹配的模型')}</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
