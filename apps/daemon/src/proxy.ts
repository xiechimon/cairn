import { BRAND, PROXY_ENV_VARS } from '@cairn/shared';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import type { DaemonLogger } from './log.js';

export function detectProxyEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const name of PROXY_ENV_VARS.slice(0, 2)) {
    const value = env[name] ?? env[name.toLowerCase()];
    if (value) return value;
  }
  return null;
}

export function loopbackNoProxy(
  env: NodeJS.ProcessEnv,
  serverUrl: string | undefined,
): string | undefined {
  if (!serverUrl) return undefined;
  let host: string;
  try {
    host = new URL(serverUrl).hostname;
  } catch {
    return undefined;
  }
  const bare = host.replace(/^\[|\]$/g, '');
  if (bare !== '127.0.0.1' && bare !== 'localhost' && bare !== '::1') return undefined;
  const existing = env.NO_PROXY ?? env.no_proxy ?? '';
  const list = existing
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (!list.includes(bare)) list.push(bare);
  return list.join(',');
}

export function setupProxy(
  logger: DaemonLogger,
  env: NodeJS.ProcessEnv = process.env,
  serverUrl?: string,
): void {
  const proxy = detectProxyEnv(env);
  if (!proxy) return;
  const noProxy = loopbackNoProxy(env, serverUrl);
  setGlobalDispatcher(new EnvHttpProxyAgent(noProxy === undefined ? undefined : { noProxy }));
  logger.raw(`[${BRAND.cliCommandName}] Proxy: ${proxy}`);
}
