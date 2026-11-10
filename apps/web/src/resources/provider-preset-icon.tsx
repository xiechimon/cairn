import type { PROVIDER_PRESET_IDS } from '@cairn/shared';
import { ProviderIcon } from '@lobehub/icons';

const PRESET_ICON: Record<(typeof PROVIDER_PRESET_IDS)[number], string> = {
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

export function ProviderPresetIcon({ id }: { id: (typeof PROVIDER_PRESET_IDS)[number] }) {
  return (
    <ProviderIcon
      provider={PRESET_ICON[id]}
      size={14}
      type="mono"
      forceMono
      className="text-current"
    />
  );
}
