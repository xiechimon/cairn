import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

export interface EnvProxy {
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
}

export function envProxyOf(env: NodeJS.ProcessEnv): EnvProxy | null {
  const httpProxy = env.http_proxy || env.HTTP_PROXY || '';
  const httpsProxy = env.https_proxy || env.HTTPS_PROXY || '';
  if (!httpProxy && !httpsProxy) return null;
  const listed = (env.no_proxy ?? env.NO_PROXY ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return {
    httpProxy,
    httpsProxy,
    noProxy: [...new Set([...listed, ...LOOPBACK_HOSTS])].join(','),
  };
}

export function installEnvProxy(env: NodeJS.ProcessEnv = process.env): string | null {
  const proxy = envProxyOf(env);
  if (proxy === null) return null;
  const shown = new URL(proxy.httpsProxy || proxy.httpProxy);
  setGlobalDispatcher(new EnvHttpProxyAgent(proxy));
  return `${shown.protocol}//${shown.host}`;
}
