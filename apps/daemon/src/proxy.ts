// 代理探测（02 §5.6/r3 §1.5：启动读系统/环境代理并打印 `[cairn] Proxy: <url>`；
// 代理死持续重试不退出——重试纪律在 machine-loop）。env 词表 = undici
// EnvHttpProxyAgent honor 三件（01 §4.3：HTTP_PROXY/HTTPS_PROXY/NO_PROXY）。
//
// #297：--server 指回环地址时把该 host 并进 no-proxy——本地回环经代理转发会把
// machine API 打成 401（首发实测：env -u 移除代理痊愈、置空无效）。
// EnvHttpProxyAgent 构造时自读 env，覆盖必须走构造参数 noProxy（先合并 env
// 既有 NO_PROXY 条目再传入，不吞用户配置）。

import { BRAND, PROXY_ENV_VARS } from '@cairn/shared';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import type { DaemonLogger } from './log.js';

export function detectProxyEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const name of PROXY_ENV_VARS.slice(0, 2)) {
    // PROXY_ENV_VARS = [HTTP_PROXY, HTTPS_PROXY, NO_PROXY]；小写变体同读。
    const value = env[name] ?? env[name.toLowerCase()];
    if (value) return value;
  }
  return null;
}

/** 回环 server → 合并后的 NO_PROXY 值；非回环/缺参/坏 URL → undefined（不注入）。 */
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
  // 行形 canon（r3 §1.5 实测 `[tds] Proxy: http://127.0.0.1:7890`；前缀品牌槽）。
  logger.raw(`[${BRAND.cliCommandName}] Proxy: ${proxy}`);
}
