import { join } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

export async function evalCodexKey(agentDir: string, signal: AbortSignal): Promise<string> {
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: null,
    refreshOnCreate: false,
    signal,
  });
  const resolved = await runtime.getAuth('openai-codex', { signal });
  const key = resolved?.auth.apiKey;
  if (!key) throw new Error('Codex subscription authentication is unavailable');
  return key;
}
