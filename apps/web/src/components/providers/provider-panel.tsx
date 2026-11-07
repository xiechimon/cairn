import { cn } from 'cn';
import { X } from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { SettingsPanel, SettingsSection } from '../settings-list.js';
import { ToggleSwitch } from '../toggle-switch.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';

export type ProviderMark = ComponentType<SVGProps<SVGSVGElement>>;

export type ProviderTone = 'ok' | 'warn' | 'fail' | 'off';

export interface ProviderSwitch {
  checked: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}

export interface ProviderItem {
  id: string;
  name: string;
  Mark: ProviderMark;
  version?: string | null;
  status: string;
  tone: ProviderTone;
  toggle?: ProviderSwitch;
}

const MONO_MARK_CLS = '[&_path]:fill-current';

export const TONE_DOT: Record<ProviderTone, string> = {
  ok: 'bg-running',
  warn: 'bg-(--waiting-ink)',
  fail: 'bg-destructive',
  off: 'bg-content-dim',
};

export function ProviderMarkTile({ Mark }: { Mark: ProviderMark }) {
  return (
    <span className="flex size-8 flex-none items-center justify-center rounded-(--radius-control) bg-background text-content-secondary ring-1 ring-border">
      <Mark aria-hidden className={cn('size-4', MONO_MARK_CLS)} />
    </span>
  );
}

export function ProviderInstanceRow({
  item,
  selected,
  onSelect,
}: {
  item: ProviderItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="provider-instance"
      data-instance-id={item.id}
      data-tone={item.tone}
      aria-current={selected ? 'true' : undefined}
      className={cn('flex items-start gap-3 px-3.5 py-3', selected && 'bg-secondary')}
    >
      <Button
        variant="ghost"
        onClick={onSelect}
        className={cn(
          'h-auto min-w-0 flex-auto items-start justify-start gap-2.5 p-0 text-left font-normal whitespace-normal hover:bg-transparent dark:hover:bg-transparent',
          item.tone === 'off' && !selected && 'opacity-60',
        )}
      >
        <item.Mark
          aria-hidden
          className={cn('mt-0.5 size-4 flex-none text-content-secondary', MONO_MARK_CLS)}
        />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-ui font-medium text-foreground">{item.name}</span>
            {item.version != null && (
              <code className="flex-none text-meta text-content-tertiary">v{item.version}</code>
            )}
          </span>
          <span className="flex items-start gap-1.5 text-meta text-content-tertiary">
            <span
              aria-hidden
              className={cn('mt-1.5 size-1.5 flex-none rounded-full', TONE_DOT[item.tone])}
            />
            <span className="line-clamp-2">{item.status}</span>
          </span>
        </span>
      </Button>
      {item.toggle !== undefined && (
        <ToggleSwitch
          aria-label={t('启用 {name}', { name: item.name })}
          checked={item.toggle.checked}
          disabled={item.toggle.disabled}
          onCheckedChange={(next) => item.toggle?.onChange?.(next)}
        />
      )}
    </div>
  );
}

export function ProviderPanel({
  items,
  selectedId,
  onSelect,
  header,
  empty,
  children,
}: {
  items: ProviderItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  header?: ReactNode;
  empty?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsPanel header={header}>
      <div className="flex min-w-0 flex-col @3xl:grid @3xl:grid-cols-[17rem_minmax(0,1fr)]">
        <div
          data-testid="provider-list"
          className="flex flex-col divide-y divide-border border-b border-border @3xl:border-r @3xl:border-b-0"
        >
          {items.map((item) => (
            <ProviderInstanceRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
            />
          ))}
        </div>
        <div data-testid="provider-editor" className="flex min-w-0 flex-col gap-6 p-4">
          {items.length === 0 ? empty : children}
        </div>
      </div>
    </SettingsPanel>
  );
}

export function ProviderEditorHead({
  Mark,
  name,
  kind,
  version,
}: {
  Mark: ProviderMark;
  name: string;
  kind: string;
  version?: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <ProviderMarkTile Mark={Mark} />
      <div className="flex min-w-0 flex-auto flex-col">
        <h2 className="m-0 truncate text-card-title font-medium text-foreground">{name}</h2>
        <span className="text-meta text-content-tertiary">{kind}</span>
      </div>
      {version != null && <code className="text-meta text-content-tertiary">v{version}</code>}
    </div>
  );
}

export function ProviderSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <SettingsSection title={title} description={hint}>
      {children}
    </SettingsSection>
  );
}

export function ProviderModelRow({
  name,
  id,
  dead = false,
  busy = false,
  onRemove,
}: {
  name: string;
  id: string;
  dead?: boolean;
  busy?: boolean;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="provider-model"
      data-model-id={id}
      data-liveness={dead ? 'dead' : 'alive'}
      className={cn(
        'settings-flat-block flex min-h-11 items-center gap-3 px-4 py-1.5',
        dead && 'text-content-tertiary',
      )}
    >
      <span className="flex min-w-0 flex-auto flex-wrap items-baseline gap-x-2">
        <span className={cn('truncate text-ui', dead ? 'line-through' : 'text-foreground')}>
          {name}
        </span>
        {name !== id && <code className="truncate text-meta text-content-tertiary">{id}</code>}
      </span>
      {dead && <Badge variant="outline">{t('已下架')}</Badge>}
      {onRemove !== undefined && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-content-tertiary"
          aria-label={t('移除 {name}', { name })}
          disabled={busy}
          onClick={onRemove}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
