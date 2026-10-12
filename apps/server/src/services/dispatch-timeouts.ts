// 派发超时策略（#864 T3 + #881 收口）：钉选机器离线/被闸挡的宽限与文案，
// 会话机楔住的亲和等待上界。
//
// 为什么单列一个叶子模块：这条策略同时管 worker 步（builds.ts 的
// sweepAbandonedBuildSteps）、chief 回合（chief.ts 的 failAbandonedChiefSteps）
// 与 claim 亲和闸（machines.ts 的 tryClaim），而 machines.ts ↔ builds.ts /
// chief.ts 之间已有环（machines 正向 import 两家），值 import 会把环拉直成真环。
// 零依赖的叶子让「一个策略一个数」在代码层可见。
//
// 策略本身（#864 裁决 + #881 补两条缝，票面三问）：
// - 等多久：钉选机器离线的 pending 步等 PIN_OFFLINE_GRACE_MS；钉选机器在线
//   但 enabledRuntimes 闸挡（#881 ①）同宽限同漏斗。比无人认领的 120 秒
//   （BUILD_ABANDONED_STEP_MS / CHIEF_ABANDONED_STEP_MS）长得多——那一档是
//   环境错配（团队根本没机器能跑），这一档常是「我指定的那台暂时不在/暂没
//   开这个 runtime」（笔记本合盖、daemon 重启、SSE 断连抖动、刚关错开关），
//   短窗口会杀掉合法的等待。闸挡与离线同宽限：runtime 开关是 PATCH 热写、
//   秒级生效，宽限给的是「用户正在改配置」的窗口，不是自愈窗口。
// - 会话机楔住（#881 ②）：亲和等待 SESSION_WEDGE_GRACE_MS。闸只让行到宽限
//   （且会话机忙 = 持有 claimed 步时不放行）；宽限后他机认领换机，降级走
//   #862 T1 的 daemon 注记（server 不预判）。
// - 谁通知：不新增通知通道，走既有失败漏斗——worker 步 = 步事件 + build.
//   errorMessage + todo → failed（看板失败卡 + 详情 banner）；chief 回合 =
//   chief_turn_error 行 + 会话流 message 事件（web toast，#631 链）。② 不产
//   失败——步被他机正常领走，降级标记由 daemon 真值面写（RESUME_FRESH_
//   SESSION_NOTE）。
// - 能否转自动：钉选两缝（离线/闸挡）不自动改派。pin 的语义是确定性
//   （t-0047 调研、#682 落地），静默换机会让「钉 A 机」变成不确定；超时的
//   产物是可见的失败加显式出口，不是另一台机器上的静默重跑。② 是自动降级
//   ——亲和是 server 侧软偏好不是用户约束，楔住时换机 + 显式注记优于失败。
//
// 判据口径：pending + 钉选机不在线（行缺失 = 已移除，同离线语义）/ 钉选机
// 闸挡 + 步的最后活动时刻（心跳 → 领取 → 入队）已过宽限。锚在「最后活动」
// 而非入队时刻，是为 T1 释放（#862）留窗口：长跑步被释放回 pending 后，
// 机器回来的机会从失联时刻起算，而不是从入队时刻倒扣。

export const PIN_OFFLINE_GRACE_MS = 10 * 60_000;

/** #881 ②：会话机在线但楔住（不领且手上无 claimed 步）时，亲和闸让行的
 *  上界。盖过 claim 长轮询节奏（hold ≈ 75s + 断网退避封顶 30s）一个量级，
 *  在线健康机器领本机会步本在一两个周期内——超此仍无认领 = 楔住判定可信；
 *  同 10 分钟量级让「有界等待」一族数字可读。 */
export const SESSION_WEDGE_GRACE_MS = 10 * 60_000;

/** #1219 ④c：钉选机在线、runtime 闸开、有空闲并发位，pending 步仍未被领的
 *  宽限。在线健康机器领步在一两个 claim 周期内（≤~105s）；有闲位仍超此不领
 *  = 该机 daemon 不在领取（实测形态：#1053 时代串行循环被一条长跑 chief 步
 *  顶住——chief 步不占 worker 槽，DB 面看是「有闲位却不动」）。宽限后按
 *  失败收尾：钉选不自动改派（④/④b 同律），失败文案点名机器与出口。
 *  已知残余（注释钉住，不静默）：机器 env 上限低于 DB 行时（#1148 server 闸
 *  取 min），「DB 有闲位」可能是假闲——失败可见可重跑，不是误删。 */
export const PIN_ONLINE_WEDGE_GRACE_MS = 10 * 60_000;

/** 步的最后活动时刻：心跳 → 领取 → 入队（T1 释放保留 claimedAt/lastHeartbeatAt
 *  作死亡时刻审计，故释放后的 pending 步锚在失联时刻）。 */
export function stepActivityAt(row: {
  lastHeartbeatAt: number | null;
  claimedAt: number | null;
  createdAt: number;
}): number {
  return row.lastHeartbeatAt ?? row.claimedAt ?? row.createdAt;
}

/** 钉选机器离线超时的失败文案（worker/chief 两族共用主语与数字，尾注按族给）。
 *  machineName = null 表示钉的机器行已不在（被删/被换团队），不吐裸 id。 */
export function pinOfflineReason(machineName: string | null, hint: string): string {
  const label = machineName ?? '（已移除）';
  return `本轮无人认领：钉选的机器「${label}」离线超过 ${PIN_OFFLINE_GRACE_MS / 60_000} 分钟。${hint}`;
}

/** worker 步的尾注：出口 = 让机器上线，或显式改钉（不自动改派）。 */
export const WORKER_PIN_OFFLINE_HINT =
  '请让它上线后重跑，或把任务的机器改为其它在线机器（重跑沿用任务的钉选）。';

/** chief 回合的尾注：回合同律，动作面是「重发」。#895 起「钉选来源」从
 *  todo 机器扩到 chief 主力机（缺省链第二级），出口文案必须同时指向两处
 *  设置面 + 自动档（T6 律：失败信息指向真实存在的出口）——改 chief 设置
 *  的主力机、清回自动，或（todo 钉选来源的线程）把任务的机器改掉。 */
export const CHIEF_PIN_OFFLINE_HINT =
  '请让它上线后重发，或改 chief 设置的主力机，或清回自动（任务钉了机器时，把任务的机器改为其它在线机器）。';

/** #881 ①：钉选机器在线但 enabledRuntimes 不含本步 runtime 的失败文案
 *  （离线版同形：点名机器，runtime 名原样透出，出口 = 开 runtime 或改钉）。 */
export function pinRuntimeBlockedReason(
  machineName: string,
  runtimeId: string,
  hint: string,
): string {
  return `本轮无人认领：钉选的机器「${machineName}」未开启本步所需的 runtime「${runtimeId}」。${hint}`;
}

/** #881 ① worker 步尾注：runtime 开关 PATCH 热写秒级生效，出口即时可动作。 */
export const WORKER_PIN_RUNTIME_HINT =
  '请在机器页为它开启该 runtime 后重跑，或把任务的机器改为其它在线机器（重跑沿用任务的钉选）。';

/** #881 ① chief 回合尾注：动作面是「重发」。 */
export const CHIEF_PIN_RUNTIME_HINT =
  '请在机器页为它开启该 runtime 后重发，或把任务的机器改为其它在线机器。';

/** #1251 ④d：钉选机器在线、runtime 闸开、但能力快照缺 agent 要求项的失败
 *  文案（点名机器 + 缺项可读名 + 修法——「缺能力 = 给修法」，Multica
 *  dispatch/reason.go 族 runtime_unusable 语义对位：等待本身不解锁，装 X
 *  才解锁）。宽限与离线/闸挡同档（PIN_OFFLINE_GRACE_MS）：能力清单随心跳
 *  30s 上行，宽限给的是「用户正在装」的窗口。 */
export function pinCapabilityBlockedReason(
  machineName: string,
  missing: string[],
  hint: string,
): string {
  return `本轮无人认领：钉选的机器「${machineName}」缺少本步 Agent 要求的能力（${missing.join('、')}）。${hint}`;
}

/** #1251 ④d worker 步尾注：修法 = 在该机装齐缺项（下一拍心跳上报即解锁）
 *  或改钉能力齐的机器（不自动改派，④/④b 同律）。 */
export const WORKER_PIN_CAPABILITY_HINT =
  '请在该机器安装/配置缺失项（下一拍心跳上报后即解锁）后重跑，或把任务的机器改为能力齐的在线机器（重跑沿用任务的钉选）。';

/** #1251 ④d chief 回合尾注：动作面是「重发」（runtime 挡尾注同形）。 */
export const CHIEF_PIN_CAPABILITY_HINT =
  '请在该机器安装/配置缺失项（下一拍心跳上报后即解锁）后重发，或改 chief 设置的主力机，或把任务的机器改为能力齐的在线机器。';

/** #1219 ④c：钉选机器在线且有空闲并发位、超宽限仍未认领的失败文案
 *  （点名机器；出口 = 检查/重启该机 daemon 或改钉）。 */
export function pinWedgeReason(machineName: string, hint: string): string {
  return `本轮无人认领：钉选的机器「${machineName}」在线且有空闲并发位，但 ${PIN_ONLINE_WEDGE_GRACE_MS / 60_000} 分钟未认领本步（其 daemon 可能未在领取或为旧版串行循环）。${hint}`;
}

/** #1219 ④c worker 步尾注。 */
export const WORKER_PIN_WEDGE_HINT =
  '请检查该机器的 daemon（重启或升级后重跑），或把任务的机器改为其它在线机器（重跑沿用任务的钉选）。';
