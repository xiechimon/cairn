import { MODEL_SOURCE_RUNTIME_LABELS, type ModelSourceRuntime } from '@cairn/shared';
import { cn } from 'cn';
import { modelEchoLabel, providerEchoLabel } from '../components/model-select-core.js';
import { useSettingsRowLabelId } from '../components/settings-list.js';
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

export function runtimeGroups(
  options: ModelOption[],
): { provider: string; providerLabel: string }[] {
  const groups: { provider: string; providerLabel: string }[] = [];
  const seen = new Set<string>();
  for (const row of options) {
    if (seen.has(row.runtime)) continue;
    seen.add(row.runtime);
    groups.push({
      provider: row.runtime,
      providerLabel: MODEL_SOURCE_RUNTIME_LABELS[row.runtime as ModelSourceRuntime] ?? row.runtime,
    });
  }
  return groups;
}

export function runtimeOfProvider(
  provider: string | null,
  options: readonly ModelOption[],
): string | null {
  if (provider === null) return null;
  if (provider === 'claude-code') return 'claude-code';
  return options.find((row) => row.provider === provider)?.runtime ?? 'pi';
}

const modelKey = (provider: string, modelId: string) => JSON.stringify([provider, modelId]);

interface AgentRuntimeSelectProps {
  id?: string;
  ariaLabel?: string;
  value: string | null;
  options: ModelOption[];
  disabled?: boolean;
  onPick?: (runtime: string | null) => void;
  prefix: string;
  triggerClassName?: string;
  unsetLabel?: string;
}

export function AgentRuntimeSelect({
  id,
  ariaLabel,
  value,
  options,
  disabled = false,
  onPick,
  prefix,
  triggerClassName,
  unsetLabel,
}: AgentRuntimeSelectProps) {
  const { t } = useI18n();
  const rowLabelId = useSettingsRowLabelId();
  const groups = runtimeGroups(options).map((group) =>
    group.provider === 'pi' ? { ...group, providerLabel: t(BUILTIN_RUNTIME_LABEL) } : group,
  );
  const unset = unsetLabel ?? t(BUILTIN_RUNTIME_LABEL);
  const label = providerEchoLabel(value, groups, unset);

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onPick?.(next as string | null)}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel == null ? (rowLabelId ?? undefined) : undefined}
        className={cn(`${prefix}-select`, triggerClassName)}
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent aria-label={t('运行时')} className={cn(`${prefix}-menu`, MODEL_MENU_FIT)}>
        <SelectItem className={`${prefix}-row`} value={null}>
          {unset}
        </SelectItem>
        {groups.map((group) => (
          <SelectItem key={group.provider} className={`${prefix}-row`} value={group.provider}>
            {group.providerLabel}
            {group.provider === 'pi' && (
              <span className="text-meta text-content-tertiary">{t('用你添加的服务商的模型')}</span>
            )}
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
  runtime: string | null;
  provider: string | null;
  modelId: string | null;
  options: ModelOption[];
  disabled?: boolean;
  onPick?: (next: { provider: string; modelId: string } | null) => void;
  prefix: string;
  triggerClassName?: string;
}

export function AgentModelSelect({
  id,
  ariaLabel,
  runtime,
  provider,
  modelId,
  options,
  disabled = false,
  onPick,
  prefix,
  triggerClassName,
}: AgentModelSelectProps) {
  const { t } = useI18n();
  const rowLabelId = useSettingsRowLabelId();
  const rows = options.filter((row) => row.runtime === runtime);
  const unset = t('未设置模型');
  const label = modelEchoLabel({ provider, modelId }, options, unset);
  const byKey = new Map(rows.map((row) => [modelKey(row.provider, row.modelId), row]));

  return (
    <Select
      value={provider !== null && modelId !== null ? modelKey(provider, modelId) : null}
      disabled={disabled || runtime === null}
      onValueChange={(next) => {
        const row = next === null ? undefined : byKey.get(next as string);
        onPick?.(row === undefined ? null : { provider: row.provider, modelId: row.modelId });
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel == null ? (rowLabelId ?? undefined) : undefined}
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
            key={`${row.machineId ?? ''}/${modelKey(row.provider, row.modelId)}`}
            className={cn(`${prefix}-row`, MODEL_ROW_WRAP)}
            title={row.modelName}
            value={modelKey(row.provider, row.modelId)}
            disabled={row.liveness === 'dead'}
          >
            {row.liveness === 'dead' ? `${row.modelName}（${t('已下架')}）` : row.modelName}
            {row.provider !== row.runtime && (
              <span className="text-meta text-content-tertiary">{row.providerLabel}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
