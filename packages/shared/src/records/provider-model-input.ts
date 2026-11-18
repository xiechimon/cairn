import type { ProviderModel } from './provider.js';
import { PROVIDER_PRESET_DEFAULTS } from './provider-preset-data.js';

type ModelInput = NonNullable<ProviderModel['input']>;

let declared: Map<string, ModelInput> | undefined;

function declaredInputs(): Map<string, ModelInput> {
  if (declared !== undefined) return declared;
  declared = new Map();
  for (const preset of Object.values(PROVIDER_PRESET_DEFAULTS)) {
    for (const model of preset.models) {
      if (model.input !== undefined && !declared.has(model.id)) declared.set(model.id, model.input);
    }
  }
  return declared;
}

export function resolveModelInput(model: Pick<ProviderModel, 'id' | 'input'>): ModelInput {
  return model.input ?? declaredInputs().get(model.id) ?? ['text'];
}
