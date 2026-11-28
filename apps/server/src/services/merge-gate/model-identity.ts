import { MODEL_ALIASES, MODEL_VENDORS } from './model-roster-data.js';

function withoutTrailingTag(model: string): string {
  if (!model.endsWith(']')) return model;
  const open = model.indexOf('[', model.lastIndexOf(']', model.length - 2) + 1);
  return open < 0 ? model : model.slice(0, open).trimEnd();
}

export function canonicalModelId(model: string): string {
  let id = withoutTrailingTag(model.trim());
  const slash = id.lastIndexOf('/');
  if (slash !== -1) id = id.slice(slash + 1);
  id = id.toLowerCase();
  return MODEL_ALIASES[id] ?? id;
}

export function modelVendor(model: string): string | null {
  return MODEL_VENDORS[canonicalModelId(model)] ?? null;
}
