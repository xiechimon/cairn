import { MODEL_SOURCE_RUNTIME_LABELS, type ModelSourceRuntime } from '@cairn/shared';
import type { ModelOption } from '../fixtures/records.js';

export const modelGroupKey = (option: ModelOption) =>
  option.runtime === 'pi' ? `pi/${option.provider}` : option.runtime;

export const modelGroupName = (option: ModelOption) =>
  option.runtime === 'pi'
    ? option.providerLabel
    : (MODEL_SOURCE_RUNTIME_LABELS[option.runtime as ModelSourceRuntime] ?? option.runtime);
