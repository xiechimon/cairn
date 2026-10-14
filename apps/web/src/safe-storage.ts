// Safe-storage 单缝（#1091）：`window.localStorage` 这个属性访问本身就会抛
// SecurityError——sandbox iframe 无 allow-same-origin（opaque origin）、
// Safari ITP / 第三方嵌入、浏览器「阻止站点数据」档都是这个形态。关键机理：
// 抛点在调用处对 `localStorage` 标识符的求值，先于任何被调函数体——所以
// reader 函数内部的 try/catch 护不住自己的调用点（new-task-dialog 的记忆位
// reader 已包 try/catch 仍会崩 boot，就是这个原因）。降级必须收在获取点：
// 本模块是全仓唯一的 localStorage 获取缝，语义照 api/auth.ts readStoredToken
// （读失败 → null 走各 reader 既有默认值回落）与 writeToken（写失败静默丢）。
// 已自带 try/catch 的旧缝（auth.ts / use-chief-surface.ts / dir-browser.tsx）
// 保持原样，不收编——它们已经在获取点内部取值。
// sessionStorage 同形（#1255 看板列滚动）：获取走 safeSessionStorage，
// 调用点不出现 sessionStorage 标识符。
//
// 消费契约：
// - 读：`readStored*(safeLocalStorage())`——null 直接进 reader 的既有
//   「无存储」回落路径（theme 跟系统 #129、locale 落 zh #74、偏好档落
//   未表态 #1031）。
// - 写：`safeSetItem(key, value)`——写不进静默丢（会话内行为不变，刷新
//   不持久），auth.ts writeToken 同律。

/** 获取 localStorage；访问本身抛 SecurityError 的环境返回 null。 */
export function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null; // 非浏览器面（SSR/单测）
  try {
    return window.localStorage;
  } catch {
    return null; // Storage 不可用面（sandbox iframe / 隐私模式 / ITP）
  }
}

/** 获取 sessionStorage；访问本身抛 SecurityError 的环境返回 null。 */
export function safeSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** 永不抛的写入：获取不到或 setItem 抛（旧 Safari 隐私模式的
 *  QuotaExceededError）都静默丢——持久化缺席不改变会话内行为。 */
export function safeSetItem(key: string, value: string): void {
  try {
    safeLocalStorage()?.setItem(key, value);
  } catch {
    // 写不进 = 不记住（auth.ts writeToken 同律）
  }
}
