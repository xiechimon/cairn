import type { ModelRef } from '@cairn/shared';
import { cn } from 'cn';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelOption } from '../fixtures/records.js';
import { Check, Search } from '../icons/index.js';
import { Button } from './ui/button.js';
import { Input } from './ui/input.js';

export interface ModelSlotValue {
  provider: string | null;
  modelId: string | null;
}

export function findModelOption(
  options: readonly ModelOption[],
  value: ModelSlotValue | null,
): ModelOption | null {
  if (value == null || value.modelId == null) return null;
  return (
    options.find((row) => row.provider === value.provider && row.modelId === value.modelId) ?? null
  );
}

export function isOptionSelected(value: ModelSlotValue | null, row: ModelOption): boolean {
  return value != null && value.provider === row.provider && value.modelId === row.modelId;
}

export function sameModelValue(a: ModelSlotValue | null, b: ModelSlotValue | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.provider === b.provider && a.modelId === b.modelId;
}

export function modelEchoLabel(
  value: ModelSlotValue | null,
  options: readonly ModelOption[],
  unsetLabel: string,
): string {
  if (value == null || value.modelId == null) return unsetLabel;
  return findModelOption(options, value)?.modelName ?? `${value.provider}/${value.modelId}`;
}

export function providerEchoLabel(
  provider: string | null,
  candidates: readonly { provider: string; providerLabel: string }[],
  unsetLabel: string,
): string {
  if (provider == null) return unsetLabel;
  return candidates.find((row) => row.provider === provider)?.providerLabel ?? provider;
}

export function createModelPicker(params: {
  value: ModelRef | null;
  close: () => void;
  onPick?: (value: ModelRef | null) => void;
}): (next: ModelRef | null) => void {
  const { value, close, onPick } = params;
  return (next) => {
    close();
    if (!sameModelValue(value, next)) onPick?.(next);
  };
}

export interface ModelRowVm {
  key: string;
  label: string;
  providerLabel: string;
  selected: boolean;
  disabled: boolean;
  value: ModelRef;
}

export function toModelRows(
  options: readonly ModelOption[],
  value: ModelSlotValue | null,
  delistedTemplate: string,
): ModelRowVm[] {
  return options.map((row) => ({
    key: `${row.provider}/${row.modelId}`,
    label:
      row.liveness === 'dead' ? delistedTemplate.replace('{name}', row.modelName) : row.modelName,
    providerLabel: row.providerLabel,
    selected: isOptionSelected(value, row),
    disabled: row.liveness === 'dead',
    value: { provider: row.provider, modelId: row.modelId },
  }));
}

export interface ModelRowSkin {
  row: string;
  col?: string;
  name: string;
  provider: string;
  check: string;
}

export const FOCUS_INSET_CLS =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--focus-ring)';

export const PICK_ROW_BTN_CLS = `w-full cursor-pointer justify-start border-none bg-transparent text-left font-normal whitespace-nowrap transition-[background-color,color] hover:bg-(--secondary) hover:text-(--foreground) dark:hover:bg-(--secondary) aria-expanded:bg-transparent aria-expanded:text-(--foreground) aria-selected:bg-(--spot-soft) active:not-aria-[haspopup]:translate-y-0 focus-visible:ring-0 ${FOCUS_INSET_CLS} [&_svg:not([class*='size-'])]:size-auto`;

interface ModelPickRowProps {
  skin: ModelRowSkin;
  selected: boolean;
  disabled?: boolean;
  label: string;
  providerLabel?: string;
  onPick: () => void;
}

export function ModelPickRow({
  skin,
  selected,
  disabled = false,
  label,
  providerLabel,
  onPick,
}: ModelPickRowProps) {
  const name = (
    <span
      data-testid="model-pick-name"
      className={cn(skin.name, 'group-aria-selected:text-(--spot-text-on-tint)')}
    >
      {label}
    </span>
  );
  const provider =
    providerLabel == null ? null : <span className={skin.provider}>{providerLabel}</span>;
  return (
    <Button
      variant="ghost"
      className={cn(
        'group',
        PICK_ROW_BTN_CLS,
        skin.row,
        disabled && 'pointer-events-none opacity-50',
      )}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onPick}
    >
      {skin.col == null ? (
        <>
          {name}
          {provider}
        </>
      ) : (
        <span className={skin.col}>
          {name}
          {provider}
        </span>
      )}
      {selected && (
        <span
          data-testid="model-pick-check"
          className={cn(skin.check, 'group-aria-selected:text-(--spot-text-on-tint)')}
        >
          <Check width={14} height={14} />
        </span>
      )}
    </Button>
  );
}

export const SEARCH_BOX_CLS =
  'flex h-8 items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-3 text-(--text-tertiary)';

export const SEARCH_INPUT_CLASS =
  'h-auto min-w-0 flex-1 rounded-none border-none bg-transparent p-0 text-sm leading-5 text-(--foreground) shadow-none placeholder:text-(--text-tertiary) focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring) focus-visible:ring-0 dark:bg-transparent';

export interface ModelPickListProps {
  skin: ModelRowSkin;
  options: readonly ModelOption[];
  value: ModelSlotValue | null;
  defaultLabel: string;
  listLabel: string;
  delistedTemplate: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  onPick: (value: ModelRef | null) => void;
}

export function ModelPickList({
  skin,
  options,
  value,
  defaultLabel,
  listLabel,
  delistedTemplate,
  searchPlaceholder,
  emptyLabel,
  onPick,
}: ModelPickListProps) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    listRef.current?.focus();
  }, []);
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source =
      q === ''
        ? options
        : options.filter(
            (row) =>
              row.modelName.toLowerCase().includes(q) ||
              row.providerLabel.toLowerCase().includes(q),
          );
    return toModelRows(source, value, delistedTemplate);
  }, [options, query, value, delistedTemplate]);

  return (
    <div className="flex min-h-0 flex-col gap-1">
      {searchOpen && (
        <div className={cn(SEARCH_BOX_CLS, 'mx-3')}>
          <Search width={14} height={14} />
          <Input
            ref={inputRef}
            className={SEARCH_INPUT_CLASS}
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              if (next === '') {
                setSearchOpen(false);
                setQuery('');
                listRef.current?.focus();
                return;
              }
              setQuery(next);
            }}
            placeholder={searchPlaceholder}
          />
        </div>
      )}
      <div
        ref={listRef}
        className={`max-h-80 overflow-y-auto overscroll-contain ${FOCUS_INSET_CLS}`}
        role="listbox"
        aria-label={listLabel}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (searchOpen || event.metaKey || event.ctrlKey || event.altKey) return;
          if (event.key.length !== 1 || event.key === ' ' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          setSearchOpen(true);
          setQuery(event.key);
        }}
      >
        <ModelPickRow
          skin={skin}
          selected={value === null}
          label={defaultLabel}
          onPick={() => onPick(null)}
        />
        {rows.map((row) => (
          <ModelPickRow
            key={row.key}
            skin={skin}
            selected={row.selected}
            disabled={row.disabled}
            label={row.label}
            providerLabel={row.providerLabel}
            onPick={() => onPick(row.value)}
          />
        ))}
        {searchOpen && query.trim() !== '' && rows.length === 0 && emptyLabel != null && (
          <div className="px-2 py-4 text-center text-[13px] text-(--text-tertiary)">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}
