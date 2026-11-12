import type { ProviderModel } from '@cairn/shared';
import { cn } from 'cn';
import { useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { useI18n } from '../i18n/provider.js';
import { PlusSmall, X } from '../icons/index.js';

const MUTED_ID_CLS = 'truncate font-mono text-caption text-content-tertiary';

const CONTEXT_CLS = 'text-caption text-content-tertiary tabular-nums';

export function pickedModels(
  catalog: readonly ProviderModel[],
  ids: readonly string[],
): ProviderModel[] {
  const byId = new Map(catalog.map((model) => [model.id, model]));
  return ids.map((id) => byId.get(id) ?? { id, name: id });
}

function contextWindowLabel(tokens: number | undefined): string {
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
  const [searching, setSearching] = useState(false);
  const byId = new Map(catalog.map((model) => [model.id, model]));
  const picked = new Set(selected);
  const options = catalog.filter((model) => !picked.has(model.id) && matches(model, query));
  const typed = query.trim();
  const canAddTyped = typed !== '' && !byId.has(typed) && !picked.has(typed);
  const add = (id: string) => {
    onSelectedChange([...selected, id]);
    setQuery('');
    setSearching(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((id) => {
        const model = byId.get(id);
        return (
          <span
            key={id}
            data-model-chip={id}
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
      <Popover
        open={searching}
        onOpenChange={(next) => {
          setSearching(next);
          if (!next) setQuery('');
        }}
      >
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
              className="h-8 border-0 bg-transparent text-ui shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
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
            {options.map((model, index) => (
              <Button
                key={model.id}
                variant="ghost"
                className={cn(
                  'grid h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left font-normal hover:bg-secondary',
                  index === 0 && typed !== '' && 'bg-secondary',
                )}
                onClick={() => add(model.id)}
              >
                <ModelLabel model={model} />
                <span className={CONTEXT_CLS}>{contextWindowLabel(model.contextWindow)}</span>
              </Button>
            ))}
            {canAddTyped && (
              <Button
                variant="ghost"
                className="h-8 w-full justify-start gap-2 rounded-md px-2 text-ui font-normal text-foreground hover:bg-secondary"
                onClick={() => add(typed)}
              >
                <PlusSmall className="size-5" />
                {t('添加自定义模型「{id}」', { id: typed })}
              </Button>
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
