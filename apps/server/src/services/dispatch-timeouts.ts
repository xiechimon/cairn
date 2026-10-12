// 派发超时策略（#864 T3 + #881 收口；#1259 起钉位 = agent 归属机；#1260 起
// chief 同律——chief 步的归属机 = 绑定 Agent 的归属机）：归属机离线/被闸挡
// 的宽限与文案。
//
// 为什么单列一个叶子模块：这条策略同时管 worker 步（builds.ts 的
// sweepAbandonedBuildSteps）与 chief 回合（chief.ts 的
// failAbandonedChiefSteps），而 machines.ts ↔ builds.ts / chief.ts 之间
// 已有环（machines 正向 import 两家），值 import 会把环拉直成真环。零依赖
// 的叶子让「一个策略一个数」在代码层可见。
//
// 策略本身（#864 裁决 + #881 补缝 + #1260 归属机口径，票面三问）：
// - 等多久：归属机离线的 pending 步等 PIN_OFFLINE_GRACE_MS；归属机在线但
//   enabledRuntimes 闸挡（#881 ①）同宽限同漏斗。比无人认领的 120 秒
//   （BUILD_ABANDONED_STEP_MS / CHIEF_ABANDONED_STEP_MS）长得多——那一档是
//   环境错配（团队根本没机器能跑），这一档常是「归属机暂时不在/暂没开这个
//   runtime」（笔记本合盖、daemon 重启、SSE 断连抖动、刚关错开关），短窗口
//   会杀掉合法的等待。闸挡与离线同宽限：runtime 开关是 PATCH 热写、秒级
//   生效，宽限给的是「用户正在改配置」的窗口，不是自愈窗口。
// - 谁通知：不新增通知通道，走既有失败漏斗——worker 步 = 步事件 + build.
//   errorMessage + todo → failed（看板失败卡 + 详情 banner）；chief 回合 =
//   chief_turn_error 行 + 会话流 message 事件（web toast，#631 链）。
// - 能否转自动：不自动改派。归属机的语义是确定性（#1259），静默换机会让
//   「绑定 A 机」变成不确定；超时的产物是可见的失败加显式出口（换绑/迁
//   移），不是另一台机器上的静默重跑。
//
// 判据口径：pending + 归属机不在线（行缺失 = 已移除，同离线语义）/ 归属机
// 闸挡 + 步的最后活动时刻（心跳 → 领取 → 入队）已过宽限。锚在「最后活动」
// 而非入队时刻，是为释放重派留窗口：长跑步被释放回 pending 后，机器回来的
// 机会从失联时刻起算，而不是从入队时刻倒扣。

export const PIN_OFFLINE_GRACE_MS = 10 * 60_000;

/** #1219 ④c：归属机在线、runtime 闸开、有空闲并发位，pending 步仍未被领的
 *  宽限。在线健康机器领步在一两个 claim 周期内（≤~105s）；有闲位仍超此不领
 *  = 该机 daemon 不在领取（实测形态：#1053 时代串行循环被一条长跑步顶住）。
 *  宽限后按失败收尾：归属不自动改派，失败文案点名机器与出口。
 *  已知残余（注释钉住，不静默）：机器 env 上限低于 DB 行时（#1148 server 闸
 *  取 min），「DB 有闲位」可能是假闲——失败可见可重跑，不是误删。 */
export const PIN_ONLINE_WEDGE_GRACE_MS = 10 * 60_000;

/** 步的最后活动时刻：心跳 → 领取 → 入队（释放保留 claimedAt/lastHeartbeatAt
 *  作死亡时刻审计，故释放后的 pending 步锚在失联时刻）。 */
export function stepActivityAt(row: {
  lastHeartbeatAt: number | null;
  claimedAt: number | null;
  createdAt: number;
}): number {
  return row.lastHeartbeatAt ?? row.claimedAt ?? row.createdAt;
}

/** 归属机离线超时的失败文案（worker/chief 两族共用主语与数字，尾注按族
 *  给）。machineName = null 表示归属机行已不在（被删/被换团队），不吐裸 id。 */
export function homeOfflineReason(machineName: string | null, hint: string): string {
  const label = machineName ?? '（已移除）';
  return `本轮无人认领：归属机「${label}」离线超过 ${PIN_OFFLINE_GRACE_MS / 60_000} 分钟。${hint}`;
}

/** worker 步的尾注：出口 = 让机器上线，或给 agent 换绑（不自动改派——
 *  归属的语义就是确定性）。 */
export const WORKER_PIN_OFFLINE_HINT =
  '请让它上线后重跑，或把 agent 的归属机改为其它在线机器（重跑沿用归属机）。';

/** chief 回合的尾注：回合同律，动作面是「重发」；chief 的归属机 = 绑定
 *  Agent 的归属机（#1260），出口落在该 Agent 的换绑上。 */
export const CHIEF_PIN_OFFLINE_HINT =
  '请让它上线后重发，或把总管绑定 Agent 的归属机改为其它在线机器。';

/** #881 ①：归属机在线但 enabledRuntimes 不含本步 runtime 的失败文案
 *  （离线版同形：点名机器，runtime 名原样透出，出口 = 开 runtime 或换绑）。 */
export function homeRuntimeBlockedReason(
  machineName: string,
  runtimeId: string,
  hint: string,
): string {
  return `本轮无人认领：归属机「${machineName}」未开启本步所需的 runtime「${runtimeId}」。${hint}`;
}

/** #881 ① worker 步尾注：runtime 开关 PATCH 热写秒级生效，出口即时可动作。 */
export const WORKER_PIN_RUNTIME_HINT =
  '请在机器页为它开启该 runtime 后重跑，或把 agent 的归属机改为其它在线机器。';

/** #881 ① chief 回合尾注：动作面是「重发」。 */
export const CHIEF_PIN_RUNTIME_HINT =
  '请在机器页为它开启该 runtime 后重发，或把总管绑定 Agent 的归属机改为其它在线机器。';

/** #1219 ④c：归属机在线且有空闲并发位、超宽限仍未认领的失败文案
 *  （点名机器；出口 = 检查/重启该机 daemon 或换绑）。 */
export function homeWedgeReason(machineName: string, hint: string): string {
  return `本轮无人认领：归属机「${machineName}」在线且有空闲并发位，但 ${PIN_ONLINE_WEDGE_GRACE_MS / 60_000} 分钟未认领本步（其 daemon 可能未在领取或为旧版串行循环）。${hint}`;
}

/** #1219 ④c worker 步尾注。 */
export const WORKER_PIN_WEDGE_HINT =
  '请检查该机器的 daemon（重启或升级后重跑），或把 agent 的归属机改为其它在线机器。';

/** #1219 ④c chief 回合尾注：动作面是「重发」。 */
export const CHIEF_PIN_WEDGE_HINT =
  '请检查该机器的 daemon（重启或升级后重发），或把总管绑定 Agent 的归属机改为其它在线机器。';

/** #1259：agent 未设归属机的失败文案（任何机器都不可领——补设即解锁，
 *  但无期静默 pending 是 bug，宽限后给可见失败）。 */
export function noHomeReason(agentName: string, hint: string): string {
  return `本轮无人认领：Agent「${agentName}」未设归属机，没有机器能认领本步。${hint}`;
}

/** noHomeReason 的 worker 步尾注。 */
export const WORKER_NO_HOME_HINT = '请在 agent 设置里指定归属机后重跑任务。';

/** noHomeReason 的 chief 回合尾注：归属位在绑定 Agent 上，动作面是「重发」。 */
export const CHIEF_NO_HOME_HINT = '请在总管绑定 Agent 的设置里指定归属机后重发。';

/** #1260：总管未绑定 Agent 的失败文案（chief 步的一切派发前提 = 绑定
 *  Agent——绑定即解锁，但无期静默 pending 是 bug，宽限后给可见失败）。 */
export const CHIEF_UNBOUND_REASON =
  '本轮无人认领：总管未绑定 Agent，没有机器能认领本轮。请在总管设置里绑定 Agent 后重发。';
