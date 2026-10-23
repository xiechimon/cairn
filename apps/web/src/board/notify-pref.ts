// 通知偏好档（#1031）：帐号页「推送通知」开关的用户意愿，独立于浏览器
// Notification.permission。为什么要分两层——权限是浏览器/OS 授予的能力面
// （granted 后页面无法撤回），偏好是用户想不想收的意愿面。旧实现把开关
// checked 直接等同于 permission==='granted'，于是 granted 态点「关」是结构性
// 空操作（处理器只在 checked===true 时动作，关不动）。本模块把「关」变成能
// 落地的动作：写本地偏好，sse.ts fireDesktopNotification 消费它——granted
// 但偏好 off 时静默不弹。
//
// 键走品牌槽（brand localStoragePrefix，locale.ts 同族）：cairn.notifyEnabled。
// 存值 '1'/'0' 而非 'on'/'off'——与 locale 的裸值风格一致，且让 e2e 能直接
// setItem('0'/'1') 驱动 sse 闸门（notify-click.spec T5）。异型/垃圾值一律回落
// null（= 未表态，显示态跟随权限），不因存储被写坏而误锁某一档。

/** 品牌槽键（单键，locale 的 dual-key 是观测复刻特例，本档无此约束）。 */
export const NOTIFY_PREF_KEY = 'cairn.notifyEnabled';

export type NotifyPref = 'on' | 'off';

/** 读偏好档：'1'→on、'0'→off、其余（未设/垃圾值/Storage 不可用 #1091）→null
 *  （跟随权限）。storage 为 null = safeLocalStorage 的不可用面，等同未表态。 */
export function readNotifyPref(storage: Pick<Storage, 'getItem'> | null): NotifyPref | null {
  let value: string | null = null;
  try {
    value = storage?.getItem(NOTIFY_PREF_KEY) ?? null;
  } catch {
    return null; // Storage 对象在但 getItem 抛——同未表态
  }
  if (value === '1') return 'on';
  if (value === '0') return 'off';
  return null;
}

/** 写偏好档（on→'1'、off→'0'）。开关每次点击都落，刷新即回读；写不进
 *  （Storage 不可用 #1091）静默丢——开关会话内照常翻转，只是不持久。 */
export function persistNotifyPref(
  pref: NotifyPref,
  storage: Pick<Storage, 'setItem'> | null,
): void {
  try {
    storage?.setItem(NOTIFY_PREF_KEY, pref === 'on' ? '1' : '0');
  } catch {
    // 写不进 = 不记住（auth.ts writeToken 同律）
  }
}
