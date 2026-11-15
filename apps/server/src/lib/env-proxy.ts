import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

export interface EnvProxy {
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
}

function isProxyUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  try {
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

const proxyValues = (env: NodeJS.ProcessEnv) => ({
  http: env.http_proxy || env.HTTP_PROXY || '',
  https: env.https_proxy || env.HTTPS_PROXY || '',
});

export function envProxyOf(env: NodeJS.ProcessEnv): EnvProxy | null {
  const values = proxyValues(env);
  const httpProxy = isProxyUrl(values.http) ? values.http : '';
  const httpsProxy = isProxyUrl(values.https) ? values.https : '';
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

export function installEnvProxy(env: NodeJS.ProcessEnv = process.env): {
  proxy: string | null;
  ignored: boolean;
} {
  const ignored = Object.values(proxyValues(env)).some((value) => value && !isProxyUrl(value));
  const proxy = envProxyOf(env);
  if (proxy === null) return { proxy: null, ignored };
  setGlobalDispatcher(new EnvHttpProxyAgent(proxy));
  const shown = new URL(proxy.httpsProxy || proxy.httpProxy);
  return { proxy: `${shown.protocol}//${shown.host}`, ignored };
}
