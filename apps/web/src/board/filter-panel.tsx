import { Funnel } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { EmptyDescription } from '../components/ui/empty.js';
import { Input } from '../components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Separator } from '../components/ui/separator.js';
import { TagChip } from '../components/ui/tag-chip.js';
import { useI18n } from '../i18n/provider.js';
import { Check, X } from '../icons/index.js';

export const TOPBAR_TEXT_BUTTON = 'h-8 gap-1.5 px-2.5 text-ui font-normal text-content-secondary';

export const TOPBAR_PRIMARY_BUTTON = 'ml-2 gap-1.5 rounded-md text-ui';

const SEARCH_THRESHOLD = 8;

export interface FilterChoice {
  value: string;
  label: string;
  color?: string;
  count: number;
}

export interface FilterDimension {
  key: string;
  name: string;
  choices: readonly FilterChoice[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  onSelectAll: () => void;
  onInvert: () => void;
  onClear: () => void;
  onOnly: (value: string) => void;
}

export interface FilterChip {
  key: string;
  label: string;
  onClear: () => void;
}

function CheckBox({ state }: { state: 'off' | 'on' | 'mixed' }) {
  return (
    <span
      aria-hidden
      className={`flex size-4 flex-none items-center justify-center rounded-(--cds-radius-sm) border transition-colors ${
        state === 'off'
          ? 'border-input'
          : state === 'on'
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-primary text-primary'
      }`}
    >
      {state === 'on' && <Check className="size-3" />}
      {state === 'mixed' && <span className="h-0.5 w-2 rounded-full bg-current" />}
    </span>
  );
}

export function FilterChips({
  chips,
  onClearAll,
}: {
  chips: readonly FilterChip[];
  onClearAll: () => void;
}) {
  const { t } = useI18n();
  if (chips.length === 0) return null;
  return (
    <div className="-m-1 flex min-w-0 items-center gap-1.5 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => (
        <Button
          key={chip.key}
          data-dimension={chip.key}
          className="h-5 flex-none gap-1 rounded-full border border-transparent bg-foreground px-2 text-[11px] leading-none font-medium text-background hover:bg-foreground active:not-aria-[haspopup]:translate-y-0"
          aria-label={t('清除{name}筛选', { name: chip.label })}
          onClick={chip.onClear}
        >
          <span className="max-w-40 truncate">{chip.label}</span>
          <X className="size-2.5" />
        </Button>
      ))}
      {chips.length > 1 && (
        <Button
          variant="ghost"
          className="h-5 flex-none rounded-full border-none px-2 text-[11px] leading-none font-medium text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent active:not-aria-[haspopup]:translate-y-0"
          onClick={onClearAll}
        >
          {t('清除全部')}
        </Button>
      )}
    </div>
  );
}

function DimensionSection({
  dimension,
  divided,
  query,
  onQuery,
}: {
  dimension: FilterDimension;
  divided: boolean;
  query: string;
  onQuery: (next: string) => void;
}) {
  const { t } = useI18n();
  const selectedSet = new Set(dimension.selected);
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle === ''
        ? dimension.choices
        : dimension.choices.filter((choice) => choice.label.toLowerCase().includes(needle)),
    [dimension.choices, needle],
  );
  const actionable = dimension.choices.length > 0;
  const allSelected = actionable && dimension.selected.length === dimension.choices.length;
  const someSelected = dimension.selected.length > 0;
  return (
    <section className="flex flex-col" data-dimension={dimension.key}>
      {divided && <Separator className="-mx-1 mt-1 mb-1" />}
      <header className={`flex items-baseline gap-1.5 px-2 pb-1 ${divided ? 'pt-1' : 'pt-1.5'}`}>
        <span className="text-caption font-medium text-content-tertiary">{t(dimension.name)}</span>
        <span className="ml-auto text-caption text-content-tertiary tabular-nums">
          {t('已选 {n}/{m}', { n: dimension.selected.length, m: dimension.choices.length })}
        </span>
      </header>
      {!actionable ? (
        <EmptyDescription className="px-2 pt-0.5 pb-2 text-meta">
          {dimension.key === 'repo' ? t('本作用域内没有可选的仓库') : t('本作用域内没有可选的类型')}
        </EmptyDescription>
      ) : (
        <>
          {dimension.choices.length > SEARCH_THRESHOLD && (
            <Input
              className="mb-1 h-6 px-2 text-xs"
              placeholder={t('搜索{name}', { name: t(dimension.name) })}
              aria-label={t('搜索{name}', { name: t(dimension.name) })}
              value={query}
              onChange={(event) => onQuery(event.target.value)}
            />
          )}
          <div className="flex items-center">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component. */}
            <label className="inline-flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-(--radius-menu-item) px-2 text-xs text-foreground transition-colors hover:bg-accent-soft">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onCheckedChange={() =>
                  allSelected ? dimension.onClear() : dimension.onSelectAll()
                }
                aria-label={t('全选')}
              />
              <span className="min-w-0 flex-1 truncate text-left">{t('全选')}</span>
            </label>
            <Button
              variant="link"
              className="mr-2 h-auto shrink-0 rounded border-none px-1 text-xs font-normal text-primary active:not-aria-[haspopup]:translate-y-0"
              onClick={dimension.onInvert}
            >
              {t('反选')}
            </Button>
          </div>
          <div
            className="flex max-h-[220px] flex-col overflow-y-auto"
            role="listbox"
            aria-multiselectable="true"
            aria-label={t(dimension.name)}
          >
            {shown.map((choice) => {
              const active = selectedSet.has(choice.value);
              const alias = choice.color == null ? '' : 'type-filter-option';
              return (
                <div key={choice.value} className="group relative flex items-center">
                  <Button
                    variant="ghost"
                    {...(choice.color == null
                      ? { 'data-project': choice.value }
                      : { 'data-tag': choice.value })}
                    role="option"
                    aria-selected={active}
                    className={`${alias} h-7 min-w-0 flex-1 justify-start gap-2 rounded-(--radius-menu-item) border-none px-2 text-xs font-normal text-foreground hover:bg-accent-soft dark:hover:bg-accent-soft active:not-aria-[haspopup]:translate-y-0 ${
                      active ? 'bg-accent' : ''
                    }`}
                    onClick={() => dimension.onToggle(choice.value)}
                  >
                    <CheckBox state={active ? 'on' : 'off'} />
                    {active && choice.color != null ? (
                      <TagChip
                        tag={{ id: choice.value, name: choice.label, color: choice.color }}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-left">{choice.label}</span>
                    )}
                    {choice.count > 0 && (
                      <span
                        data-testid="option-count"
                        className="ml-auto text-[11px] text-muted-foreground tabular-nums transition-opacity group-hover:opacity-0"
                      >
                        {choice.count}
                      </span>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={dimension.selected.length === 0}
                    className="absolute right-2 h-auto shrink-0 rounded border-none px-1 text-[11px] font-normal text-muted-foreground opacity-0 transition-opacity hover:bg-transparent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-transparent disabled:opacity-0 disabled:group-hover:opacity-100 active:not-aria-[haspopup]:translate-y-0"
                    onClick={() => dimension.onOnly(choice.value)}
                  >
                    {t('仅此')}
                  </Button>
                </div>
              );
            })}
            {shown.length === 0 && (
              <EmptyDescription className="px-1.5 py-1.5 text-xs">
                {t('没有与“{q}”匹配的选项', { q: query })}
              </EmptyDescription>
            )}
          </div>
        </>
      )}
    </section>
  );
}

interface FilterPanelProps {
  dimensions: readonly FilterDimension[];
  totalSelected: number;
  onClearAll: () => void;
}

export function FilterPanel({ dimensions, totalSelected, onClearAll }: FilterPanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<Record<string, string>>({});
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery({});
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={`board-type-filter ${TOPBAR_TEXT_BUTTON}`}
            aria-label={t('筛选')}
          />
        }
      >
        <Funnel aria-hidden strokeWidth={1.75} className="size-3.5 text-content-tertiary" />
        {t('筛选')}
        {totalSelected > 0 && (
          <span
            data-testid="filter-count"
            className="rounded-full bg-accent px-1.5 text-caption font-normal tabular-nums text-muted-foreground"
          >
            {totalSelected}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        aria-label={t('筛选')}
        className="type-filter-popover w-[268px] gap-0 p-(--menu-pad)"
      >
        {dimensions.map((dimension, index) => (
          <DimensionSection
            key={dimension.key}
            dimension={dimension}
            divided={index > 0}
            query={query[dimension.key] ?? ''}
            onQuery={(next) => setQuery((prev) => ({ ...prev, [dimension.key]: next }))}
          />
        ))}
        {totalSelected > 0 && (
          <Button
            variant="ghost"
            className="mt-0.5 h-7 w-full rounded-(--cds-radius-sm) border-none text-xs font-normal text-muted-foreground hover:bg-accent-soft hover:text-foreground dark:hover:bg-accent-soft active:not-aria-[haspopup]:translate-y-0"
            onClick={onClearAll}
          >
            {t('清除全部')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
