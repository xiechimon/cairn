import { MODEL_SOURCE_RUNTIME_LABELS, type ModelSourceRuntime } from '@cairn/shared';
import type { ModelOption } from '../fixtures/records.js';

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

export const modelGroupKey = (option: ModelOption) =>
  option.runtime === 'pi' ? `pi/${option.provider}` : option.runtime;

export const modelGroupName = (option: ModelOption) =>
  option.runtime === 'pi'
    ? option.providerLabel
    : (MODEL_SOURCE_RUNTIME_LABELS[option.runtime as ModelSourceRuntime] ?? option.runtime);
