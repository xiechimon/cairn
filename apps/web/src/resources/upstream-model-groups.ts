import type { UpstreamOption } from './upstream-model-picker.js';

const NATIVE_IDS = new Set([
  'adaptive',
  'swe-2',
  'swe-2-flash',
  'swe-2-1',
  'swe-2-high',
  'swe-2-flash-medium',
]);

const VENDOR_LABELS: [RegExp, string][] = [
  [/^(swe|devin)-|^adaptive/, 'Devin 原生'],
  [/^claude[-\s]/, 'Claude'],
  [/^(gpt|o[0-9])[-\s]/, 'GPT'],
  [/^gemini[-\s]/, 'Gemini'],
  [/^kimi[-\s]/, 'Kimi'],
  [/^(glm|zhipu)[-\s]/, 'GLM'],
  [/^deepseek[-\s]/, 'DeepSeek'],
  [/^qwen[-\s]/, 'Qwen'],
  [/^grok[-\s]/, 'Grok'],
];

const ANTIGRAVITY_FAMILY_LABELS: [RegExp, string][] = [
  [/^gemini[-\s]|^orchestrator\b/, 'Gemini'],
  [/^claude[-\s]/, 'Claude'],
  [/^gpt-oss[-\s]/, 'GPT-OSS'],
  [/^(gpt|o[0-9])[-\s]/, 'GPT'],
];

function vendorOf(model: UpstreamOption): string {
  const id = model.id.toLowerCase();
  for (const [pattern, label] of VENDOR_LABELS) {
    if (pattern.test(id)) return label;
  }
  const family = (model.family ?? model.id).split(/[-\s(]/)[0] ?? '';
  if (family === '') return '其他';
  return family.charAt(0).toUpperCase() + family.slice(1);
}

function antigravityFamilyOf(model: UpstreamOption): string {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  for (const [pattern, label] of ANTIGRAVITY_FAMILY_LABELS) {
    if (pattern.test(id) || pattern.test(name)) return label;
  }
  return vendorOf(model);
}

const isFusion = (model: UpstreamOption) =>
  model.id.toLowerCase().startsWith('fusion') || /^fusion/i.test(model.family ?? '');

export function groupDevinUpstream(models: UpstreamOption[]): [string, UpstreamOption[]][] {
  const native: UpstreamOption[] = [];
  const fusion: UpstreamOption[] = [];
  const byVendor = new Map<string, UpstreamOption[]>();
  for (const model of models) {
    if (NATIVE_IDS.has(model.id)) {
      native.push(model);
      continue;
    }
    if (isFusion(model)) {
      fusion.push(model);
      continue;
    }
    const vendor = vendorOf(model);
    const group = byVendor.get(vendor);
    if (group === undefined) byVendor.set(vendor, [model]);
    else group.push(model);
  }
  const vendors = [...byVendor.entries()].sort(([a], [b]) =>
    a === 'Devin 原生' ? -1 : b === 'Devin 原生' ? 1 : a.localeCompare(b),
  );
  return [
    ...(native.length > 0 ? [['Devin 原生', native] as [string, UpstreamOption[]]] : []),
    ...vendors,
    ...(fusion.length > 0 ? [['Fusion 组合', fusion] as [string, UpstreamOption[]]] : []),
  ];
}

export function groupAntigravityUpstream(models: UpstreamOption[]): [string, UpstreamOption[]][] {
  const byFamily = new Map<string, UpstreamOption[]>();
  for (const model of models) {
    const family = antigravityFamilyOf(model);
    const group = byFamily.get(family);
    if (group === undefined) byFamily.set(family, [model]);
    else group.push(model);
  }
  return [...byFamily.entries()].sort(([a], [b]) =>
    a === '其他' ? 1 : b === '其他' ? -1 : a.localeCompare(b),
  );
}

const DOUBAO_FAMILY_LABELS: [RegExp, string][] = [
  [/^(4|5|9|seed-|doubao\b)/i, 'Doubao'],
  [/deepseek/i, 'DeepSeek'],
  [/glm/i, 'GLM'],
  [/kimi/i, 'Kimi'],
  [/qwen/i, 'Qwen'],
  [/mimo/i, 'MiMo'],
];

export function groupDoubaoUpstream(models: UpstreamOption[]): [string, UpstreamOption[]][] {
  const byFamily = new Map<string, UpstreamOption[]>();
  for (const model of models) {
    const hay = `${model.id} ${model.name}`;
    const hit = DOUBAO_FAMILY_LABELS.find(([pattern]) => pattern.test(hay));
    const family = hit === undefined ? '其他' : hit[1];
    const group = byFamily.get(family);
    if (group === undefined) byFamily.set(family, [model]);
    else group.push(model);
  }
  return [...byFamily.entries()].sort(([a], [b]) =>
    a === 'Doubao'
      ? -1
      : b === 'Doubao'
        ? 1
        : a === '其他'
          ? 1
          : b === '其他'
            ? -1
            : a.localeCompare(b),
  );
}
