import type { PROVIDER_PRESET_IDS } from '@cairn/shared';
import type { SVGProps } from 'react';
import type { ProviderMark } from '../components/providers/provider-panel.js';
import { LOBEHUB_MONO } from '../icons/lobehub-mono.js';

const PRESET_ICON: Record<PresetId, keyof typeof LOBEHUB_MONO> = {
  'github-copilot': 'github-copilot',
  'openai-codex': 'openai',
  xai: 'xai',
  'amazon-bedrock': 'bedrock',
  'ant-ling': 'antgroup',
  anthropic: 'anthropic',
  baseten: 'baseten',
  cerebras: 'cerebras',
  'cloudflare-ai-gateway': 'cloudflare',
  'cloudflare-workers-ai': 'cloudflare',
  deepseek: 'deepseek',
  fireworks: 'fireworksai',
  google: 'google',
  'google-vertex': 'vertexai',
  groq: 'groq',
  huggingface: 'huggingface',
  'kimi-coding': 'moonshot',
  minimax: 'minimax',
  'minimax-cn': 'minimax',
  mistral: 'mistral',
  moonshotai: 'moonshot',
  'moonshotai-cn': 'moonshot',
  nvidia: 'nvidia',
  openai: 'openai',
  opencode: 'opencode',
  'opencode-go': 'opencodego',
  openrouter: 'openrouter',
  'qwen-token-plan': 'qwen',
  'qwen-token-plan-cn': 'qwen',
  'qwen-token-plan-individual': 'qwen',
  together: 'togetherai',
  'vercel-ai-gateway': 'vercelaigateway',
  xiaomi: 'xiaomimimo',
  'xiaomi-token-plan-ams': 'xiaomimimo',
  'xiaomi-token-plan-cn': 'xiaomimimo',
  'xiaomi-token-plan-sgp': 'xiaomimimo',
  'z-ai': 'zhipu',
  'z-ai-coding-cn': 'zhipu',
};

type PresetId = (typeof PROVIDER_PRESET_IDS)[number];

export function presetMarkOf(providerId: string): ProviderMark | undefined {
  return Object.hasOwn(PRESET_ICON, providerId)
    ? PRESET_MARKS.get(PRESET_ICON[providerId as PresetId])
    : undefined;
}

const PRESET_MARKS = new Map(
  [...new Set(Object.values(PRESET_ICON))].map((key) => {
    const mark = LOBEHUB_MONO[key];
    const Mark = ({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) => (
      <svg
        aria-hidden
        viewBox={mark.viewBox}
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        width={width}
        height={height}
        {...props}
      >
        {mark.paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
    return [key, Mark] as const;
  }),
);

export function ProviderPresetIcon({ id }: { id: PresetId }) {
  const Mark = PRESET_MARKS.get(PRESET_ICON[id]);
  return Mark === undefined ? null : <Mark width={14} height={14} className="text-current" />;
}
