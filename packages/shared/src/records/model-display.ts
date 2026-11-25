import {
  DEFAULT_ANTIGRAVITY_MODELS,
  DEFAULT_CLAUDE_CODE_MODELS,
  DEFAULT_DEVIN_MODELS,
} from './model-source.js';

const BUILTIN_MODEL_NAMES = new Map<string, string>(
  [...DEFAULT_CLAUDE_CODE_MODELS, ...DEFAULT_DEVIN_MODELS, ...DEFAULT_ANTIGRAVITY_MODELS].map(
    (model) => [model.id, model.name],
  ),
);

const CLAUDE_FAMILY_RE =
  /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?(?:-(thinking))?(?:-\d{8})?(?:\[1m\])?$/i;
const SWE_MODEL_RE = /^swe-(\d+)(?:-(\d+))?(?:-(flash))?(?:-(?:low|medium|high|max))?$/i;
const DEEPSEEK_V_RE = /^deepseek-v(\d+(?:\.\d+)?)(?:-(flash|chat|reasoner))?$/i;

function titleWord(word: string): string {
  return word.length === 0 ? '' : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;
}

export function parseModelKey(raw: string): { provider: string | null; modelId: string } {
  const slash = raw.indexOf('/');
  if (slash <= 0) return { provider: null, modelId: raw };
  return { provider: raw.slice(0, slash), modelId: raw.slice(slash + 1) };
}

export function formatModelDisplayName(rawOrId: string): string {
  const { modelId } = parseModelKey(rawOrId);
  const builtin = BUILTIN_MODEL_NAMES.get(modelId);
  if (builtin !== undefined) return builtin;

  const swe = SWE_MODEL_RE.exec(modelId);
  if (swe !== null) {
    const version = swe[2] !== undefined ? `${swe[1]}.${swe[2]}` : swe[1];
    const flash = swe[3] !== undefined ? ' Flash' : '';
    return `SWE-${version}${flash}`;
  }

  const claude = CLAUDE_FAMILY_RE.exec(modelId);
  if (claude !== null) {
    const family = titleWord(claude[1] ?? '');
    const version = claude[3] !== undefined ? `${claude[2]}.${claude[3]}` : claude[2];
    const thinking = claude[4] !== undefined ? ' (Thinking)' : '';
    return `Claude ${family} ${version}${thinking}`;
  }

  const deepseek = DEEPSEEK_V_RE.exec(modelId);
  if (deepseek !== null) {
    const suffix = deepseek[2] !== undefined ? ` ${titleWord(deepseek[2])}` : '';
    return `DeepSeek V${deepseek[1]}${suffix}`;
  }

  if (modelId === 'deepseek-chat') return 'DeepSeek Chat';
  if (modelId === 'deepseek-reasoner') return 'DeepSeek Reasoner';

  return modelId;
}
