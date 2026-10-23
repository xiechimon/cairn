// 可选 token 鉴权的 web 面单缝（#253，spec #247 D8/D9）：token 存取 + 门页
// 开关信号，client.ts（REST）与 sse.ts（SSE）两个消费面都只认这里。server
// 契约（apps/server/src/lib/token-auth.ts）：Bearer 头主干道；仅两条 stream
// 端点收 ?token=（EventSource 无法设 header）；401 形状 = {error}。
// 失败方式（e2e/token-gate.spec.ts 固化）：
//   1. 开 + 无 token 首访 → 401 → demandGate 落门页（盖住 UI）
//   2. 错 token → 门页 probe 401 → 停留 + 清输入，localStorage 从不写坏值
//   3. 陈旧坏 token → 401 落门页即清除（SSE 不得带坏 token 重连）
//   4. 放行后 → 停车的原请求全部重试、SSE 以新 token ?token= 重连
//   5. 并发 401 → demandGate 幂等，门页只开一次、无死循环
//   6. 关 → 永无 401，门页永不出现（本模块零副作用）
// 门页 probe（probeToken）走裸 fetch 不经 client.ts——避免 probe 的 401
// 递归 demandGate。UI 面 = overlay/token-gate.tsx。

import { useSyncExternalStore } from 'react';

/** localStorage 键（品牌前缀纪律同 cairn.locale / cairn.sidebar-collapsed）。 */
export const TOKEN_STORAGE_KEY = 'cairn.token';

export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null; // storage 不可用面（隐私模式等）静默降级为无 token
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_STORAGE_KEY);
    else localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // 同 readStoredToken 降级：写不进 = 会话级放行，刷新后门页重开
  }
}

export interface AuthSnapshot {
  /** 门页开关：401 置位，输 token probe 通过后清零。 */
  gateOpen: boolean;
}

// snapshot 只在 publish 时换引用——useSyncExternalStore 的 getSnapshot 稳定性
// 契约（每次新建对象 = 无限重渲染）；引用变化同时是 SSE hook 的重连信号
// （token 变了流 URL 要重建）。
let snapshot: AuthSnapshot = { gateOpen: false };
const listeners = new Set<() => void>();
let gateWaiters: Array<() => void> = [];

function publish(gateOpen: boolean): void {
  snapshot = { gateOpen };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React 消费面：门页渲染开关 + SSE hook 重连依赖。 */
export function useAuth(): AuthSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** 门页 probe 端点 = 应用自身的首个数据请求（LiveDataBridge useTeams 同款）。
 *  裸 fetch 不经 client.ts：client 的 401 会 demandGate，probe 的 401 只是
 *  「令牌无效」的普通信号，递归会把门页状态打乱。 */
const PROBE_PATH = '/api/teams';

/** 候选 token 是否被 server 接受（网络级失败同「无效」处理）。 */
export async function probeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(PROBE_PATH, { headers: { authorization: `Bearer ${token}` } });
    return res.ok;
  } catch {
    return false;
  }
}

/** 401 → 落门页（幂等，失败方式 5）。既有 token（若有）刚被 server 判为
 *  无效——立即清除，SSE 重连面不再携带坏值（失败方式 3）。 */
export function demandGate(): void {
  writeToken(null);
  if (!snapshot.gateOpen) publish(true);
}

/** 门页 probe 通过：写入新 token 并放行——唤醒所有停车的原请求（失败方式 4），
 *  snapshot 换引用同时触发 SSE 以新 token 重建流。 */
export function passGate(token: string): void {
  writeToken(token);
  const waiters = gateWaiters;
  gateWaiters = [];
  publish(false);
  for (const wake of waiters) wake();
}

/** 等门页关闭（未开 = 立即 resolve）——client.ts 的 401 重试停车于此。 */
export function awaitGate(): Promise<void> {
  if (!snapshot.gateOpen) return Promise.resolve();
  return new Promise<void>((resolve) => {
    gateWaiters.push(resolve);
  });
}
