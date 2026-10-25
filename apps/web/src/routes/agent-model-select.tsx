import { cn } from 'cn';
import { modelEchoLabel, providerEchoLabel } from '../components/model-select-core.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import type { ModelOption } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

export const BUILTIN_RUNTIME_LABEL = '内置 (pi)';

export function providerGroups(
  options: ModelOption[],
): { provider: string; providerLabel: string }[] {
  const groups: { provider: string; providerLabel: string }[] = [];
  const seen = new Set<string>();
  for (const row of options) {
    if (seen.has(row.provider)) continue;
    seen.add(row.provider);
    groups.push({ provider: row.provider, providerLabel: row.providerLabel });
  }
  return groups;
}

interface AgentRuntimeSelectProps {
  id?: string;
  ariaLabel?: string;
  value: string | null;
  options: ModelOption[];
  onPick?: (provider: string | null) => void;
  prefix: string;
  triggerClassName?: string;
  unsetLabel?: string;
}

export function AgentRuntimeSelect({
  id,
  ariaLabel,
  value,
  options,
  onPick,
  prefix,
  triggerClassName,
  unsetLabel,
}: AgentRuntimeSelectProps) {
  const { t } = useI18n();
  const groups = providerGroups(options);
  const unset = unsetLabel ?? t(BUILTIN_RUNTIME_LABEL);
  const label = providerEchoLabel(value, groups, unset);

  return (
    <Select value={value} onValueChange={(next) => onPick?.(next as string | null)}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(`${prefix}-select`, triggerClassName)}
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent aria-label={t('运行时')} className={`${prefix}-menu`}>
        <SelectItem className={`${prefix}-row`} value={null}>
          {unset}
        </SelectItem>
        {groups.map((group) => (
          <SelectItem key={group.provider} className={`${prefix}-row`} value={group.provider}>
            {group.providerLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const MODEL_MENU_FIT = 'w-max min-w-(--anchor-width) max-w-(--available-width)';

const MODEL_ROW_WRAP =
  '[&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:break-all [&>:first-child]:whitespace-normal';

interface AgentModelSelectProps {
  id?: string;
  ariaLabel?: string;
  provider: string | null;
  modelId: string | null;
  options: ModelOption[];
  disabled?: boolean;
  onPick?: (modelId: string | null) => void;
  prefix: string;
  triggerClassName?: string;
}

export function AgentModelSelect({
  id,
  ariaLabel,
  provider,
  modelId,
  options,
  disabled = false,
  onPick,
  prefix,
  triggerClassName,
}: AgentModelSelectProps) {
  const { t } = useI18n();
  const rows = options.filter((row) => row.provider === provider);
  const unset = t('未设置模型');
  const label = modelEchoLabel({ provider, modelId }, options, unset);

  return (
    <Select
      value={modelId}
      disabled={disabled || provider === null}
      onValueChange={(next) => onPick?.(next as string | null)}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(`${prefix}-select`, triggerClassName)}
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        aria-label={t('模型')}
        className={cn(
          `${prefix}-menu rounded-(--radius-popover) shadow-(--shadow-popover)`,
          MODEL_MENU_FIT,
        )}
      >
        <SelectItem className={`${prefix}-row`} value={null}>
          {unset}
        </SelectItem>
        {rows.map((row) => (
          <SelectItem
            key={`${row.machineId ?? ''}/${row.modelId}`}
            className={cn(`${prefix}-row`, MODEL_ROW_WRAP)}
            title={row.modelName}
            value={row.modelId}
            disabled={row.liveness === 'dead'}
          >
            {row.liveness === 'dead' ? `${row.modelName}（${t('已下架')}）` : row.modelName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
