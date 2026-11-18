import type { UpstreamOption } from './upstream-model-picker.js';

const NATIVE_IDS = new Set(['adaptive', 'swe-2-high', 'swe-2-flash-medium']);

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

function vendorOf(model: UpstreamOption): string {
  const id = model.id.toLowerCase();
  for (const [pattern, label] of VENDOR_LABELS) {
    if (pattern.test(id)) return label;
  }
  const family = (model.family ?? model.id).split(/[-\s(]/)[0] ?? '';
  if (family === '') return '其他';
  return family.charAt(0).toUpperCase() + family.slice(1);
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
