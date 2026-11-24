import { Combobox } from '@base-ui/react/combobox';
import { cn } from 'cn';
import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { useI18n } from '../i18n/provider.js';

export interface PickOption {
  value: string;
  label: string;
  detail?: string;
  group?: string;
  groupLabel?: string;
  disabled?: boolean;
  keywords?: string;
}

interface PickGroup {
  value: string;
  label: string;
  items: PickOption[];
}

export const FILTER_THRESHOLD = 10;

const FIELD_SHOWN =
  '-mx-1 -mt-1 mb-1 flex h-10 flex-none items-center gap-2 border-b border-border pr-3 pl-3.5 text-content-tertiary pointer-coarse:h-12';

const COARSE_SHOWN =
  'pointer-coarse:-mx-1 pointer-coarse:-mt-1 pointer-coarse:mb-1 pointer-coarse:flex pointer-coarse:h-12 pointer-coarse:flex-none pointer-coarse:items-center pointer-coarse:gap-2 pointer-coarse:border-b pointer-coarse:border-border pointer-coarse:pr-3 pointer-coarse:pl-3.5 pointer-coarse:text-content-tertiary';

const fold = (text: string) => text.toLowerCase().replace(/[\s\-_.()（）·/]/g, '');

export function matchesQuery(option: PickOption, query: string): boolean {
  const words = query.split(/\s+/).map(fold).filter(Boolean);
  const hay = [option.label, option.detail, option.groupLabel ?? option.group, option.keywords]
    .filter((part): part is string => part !== undefined)
    .map(fold);
  return words.every((word) => hay.some((part) => part.includes(word)));
}

function Marked({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase();
  const hit = new Array<boolean>(text.length).fill(false);
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = lower.indexOf(word);
    if (at >= 0) hit.fill(true, at, at + word.length);
  }
  const parts: { text: string; bold: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts.at(-1);
    if (last !== undefined && last.bold === hit[i]) last.text += text[i];
    else parts.push({ text: text[i] ?? '', bold: hit[i] === true });
  }
  return (
    <>
      {parts.map((part, i) =>
        part.bold ? (
          <b key={i} className="font-semibold">
            {part.text}
          </b>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

function grouped(options: readonly PickOption[]): PickGroup[] {
  const groups = new Map<string, PickGroup>();
  for (const option of options) {
    const key = option.group ?? '';
    const group = groups.get(key) ?? {
      value: key,
      label: option.groupLabel ?? key,
      items: [],
    };
    group.items.push(option);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function FilterPicker({
  options,
  value,
  onPick,
  label,
  placeholder,
  noun,
  open,
  onOpenChange,
  alwaysFilter = false,
  filterLabel,
  emptyText,
  loading = false,
  header,
  footer,
  popupTestId,
  trigger,
  triggerClassName,
  triggerContent,
  triggerId,
  triggerTestId,
  disabled = false,
  popupClassName,
  rowClassName,
  align = 'start',
}: {
  options: readonly PickOption[];
  value: string | null;
  onPick: (value: string) => void;
  label: string;
  placeholder: string;
  noun: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  alwaysFilter?: boolean;
  filterLabel?: string;
  emptyText?: string;
  loading?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  popupTestId?: string;
  trigger?: ReactElement;
  triggerClassName?: string;
  triggerContent?: ReactNode;
  triggerId?: string;
  triggerTestId?: string;
  disabled?: boolean;
  popupClassName?: string;
  rowClassName?: string;
  align?: 'start' | 'end';
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const filterable = alwaysFilter || options.length > FILTER_THRESHOLD;
  const typed = query.trim();
  const groups = grouped(options);
  const shown = typed === '' ? groups : grouped(options.filter((o) => matchesQuery(o, typed)));
  const count = shown.reduce((sum, group) => sum + group.items.length, 0);
  const picked = options.find((option) => option.value === value) ?? null;
  const hasEmptyCopy =
    !loading && (typed !== '' || (options.length === 0 && emptyText !== undefined));
  const hasBody = count > 0 || hasEmptyCopy;
  return (
    <Combobox.Root<PickOption>
      items={groups}
      filteredItems={shown}
      filter={null}
      value={picked}
      disabled={disabled}
      autoHighlight
      {...(open === undefined ? {} : { open })}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      inputValue={query}
      onInputValueChange={(next) => setQuery(filterable ? next : '')}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && details.reason === 'escape-key' && query !== '') {
          details.cancel();
          setQuery('');
          return;
        }
        if (!nextOpen) setQuery('');
        onOpenChange?.(nextOpen);
      }}
      onValueChange={(next) => {
        if (next !== null && next.value !== value) onPick(next.value);
      }}
    >
      <Combobox.Trigger
        id={triggerId}
        data-testid={triggerTestId}
        data-slot={trigger === undefined ? 'select-trigger' : undefined}
        aria-label={label}
        {...(trigger === undefined ? {} : { render: trigger })}
        className={
          trigger === undefined
            ? cn(
                "flex h-8 w-fit min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                triggerClassName,
              )
            : triggerClassName
        }
      >
        {trigger === undefined ? (
          <>
            <span
              data-slot="select-value"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            >
              {triggerContent ?? (
                <>
                  <span className="max-w-full flex-none truncate">{picked?.label ?? ''}</span>
                  {picked?.detail !== undefined && (
                    <span className="min-w-0 truncate text-meta text-content-tertiary">
                      {picked.detail}
                    </span>
                  )}
                </>
              )}
            </span>
            <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground" />
          </>
        ) : (
          triggerContent
        )}
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          side="bottom"
          align={align}
          sideOffset={6}
          collisionPadding={16}
          className="isolate z-50"
        >
          <Combobox.Popup
            data-slot="select-content"
            data-testid={popupTestId}
            aria-label={label}
            className={cn(
              'flex max-h-(--available-height) w-80 min-w-(--anchor-width) flex-col max-sm:w-89 bg-popover text-popover-foreground outline-none',
              popupClassName,
            )}
          >
            {header !== undefined && (
              <div className="-mx-1 -mt-1 flex flex-none items-center justify-between gap-2 border-b border-border px-3 py-2 text-caption text-content-tertiary">
                {header}
              </div>
            )}
            <div
              data-slot="picker-filter"
              className={
                alwaysFilter || (filterable && typed !== '')
                  ? cn(FIELD_SHOWN, header !== undefined && 'mt-0', !hasBody && 'mb-0')
                  : cn(
                      'sr-only',
                      filterable && 'pointer-coarse:not-sr-only',
                      filterable && COARSE_SHOWN,
                      header !== undefined && 'pointer-coarse:mt-0',
                    )
              }
            >
              <SearchIcon aria-hidden className="size-4 flex-none" />
              <Combobox.Input
                placeholder={placeholder}
                aria-label={filterLabel ?? t('筛选{noun}', { noun })}
                readOnly={!filterable}
                className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-ui text-foreground outline-hidden placeholder:text-content-tertiary"
              />
              {filterable && !loading && (
                <span className="flex-none text-caption text-content-tertiary">
                  {t('{count} 个{noun}', { count: typed === '' ? options.length : count, noun })}
                </span>
              )}
            </div>
            <Combobox.Empty>
              {hasEmptyCopy && (
                <p className="m-0 px-3 py-5 text-center text-meta text-content-tertiary">
                  {emptyText ?? t('没有匹配「{query}」的{noun}', { query: typed, noun })}
                </p>
              )}
            </Combobox.Empty>
            <Combobox.List className="max-h-96 min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-py-1 outline-none empty:hidden">
              {(group: PickGroup) => (
                <Combobox.Group key={group.value} items={group.items}>
                  {group.label !== '' && typed === '' && (
                    <Combobox.GroupLabel
                      data-slot="select-label"
                      className="px-2.5 pt-2 pb-1 text-caption font-medium text-content-tertiary first:pt-1"
                    >
                      {group.label}
                    </Combobox.GroupLabel>
                  )}
                  <Combobox.Collection>
                    {(option: PickOption) => (
                      <Combobox.Item
                        key={option.value}
                        value={option}
                        disabled={option.disabled}
                        data-slot="select-item"
                        className={cn(
                          'relative flex w-full cursor-default items-center outline-hidden select-none data-disabled:text-content-tertiary pointer-coarse:min-h-11',
                          rowClassName,
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <Marked text={option.label} query={typed} />
                        </span>
                        {option.detail !== undefined &&
                          (typed !== '' || option.group === undefined) && (
                            <span className="max-w-40 flex-none truncate text-meta text-content-tertiary">
                              <Marked text={option.detail} query={typed} />
                            </span>
                          )}
                        <Combobox.ItemIndicator
                          render={
                            <span className="pointer-events-none absolute right-2.5 flex size-4 items-center justify-center" />
                          }
                        >
                          <CheckIcon aria-hidden className="size-4" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
            {footer !== undefined ? (
              <div
                className={cn(
                  '-mx-1 -mb-1 flex flex-none flex-col gap-1 px-3 py-2 text-caption text-content-tertiary',
                  hasBody && 'mt-1 border-t border-border',
                )}
              >
                {footer}
              </div>
            ) : (
              filterable &&
              (!alwaysFilter || typed !== '') && (
                <div className="-mx-1 -mb-1 mt-1 flex h-9 flex-none items-center justify-between gap-2 border-t border-border px-3 text-caption text-content-tertiary pointer-coarse:hidden">
                  {typed === '' ? (
                    <>
                      <span>{t('输入可筛选')}</span>
                      <span>{t('{count} 个{noun}', { count: options.length, noun })}</span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-2">
                        {count > 0 && (
                          <>
                            <span>{t('↑↓ 选择')}</span>
                            <span>{t('↵ 确认')}</span>
                          </>
                        )}
                      </span>
                      <span>{t('Esc 清空')}</span>
                    </>
                  )}
                </div>
              )
            )}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
