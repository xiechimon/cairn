import { BRAND, PROXY_ENV_VARS } from '@cairn/shared';
import {
  Agent,
  type Dispatcher,
  EnvHttpProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici';
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

export interface ProxyHandle {
  reset(): void;
}

export function setupProxy(
  logger: DaemonLogger,
  env: NodeJS.ProcessEnv = process.env,
  serverUrl?: string,
): ProxyHandle {
  const proxy = detectProxyEnv(env);
  const noProxy = loopbackNoProxy(env, serverUrl);
  const build = (): Dispatcher =>
    proxy
      ? new EnvHttpProxyAgent({
          httpProxy: env.http_proxy ?? env.HTTP_PROXY,
          httpsProxy: env.https_proxy ?? env.HTTPS_PROXY,
          noProxy: noProxy ?? env.no_proxy ?? env.NO_PROXY,
        })
      : new Agent();
  let installed: Dispatcher | null = null;
  if (proxy) {
    installed = build();
    setGlobalDispatcher(installed);
    logger.raw(`[${BRAND.cliCommandName}] Proxy: ${proxy}`);
  }
  return {
    reset() {
      const previous = installed ?? getGlobalDispatcher();
      installed = build();
      setGlobalDispatcher(installed);
      previous.destroy().catch(() => {});
    },
  };
}
