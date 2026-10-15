// machine record（server 侧）——02 §6.2 未列字段表（「machine（server 侧记录）
// + 详情 tab（信息/构建、在线/离线、max 显示）」）；以下为观测支撑的最小投影，
// 未特写字段归 M2 实现期展开 [推断]（04 §3 不判负口径）。
// 机器 = 登记的执行主机（pacman daemon + 内嵌 pi runtime，CONTEXT.md）；
// 一个机器可承载多个 Agent 的步，不是 Agent 的属性。

import { z } from 'zod';
import { recordId } from './common.js';
import { machineCapabilitiesSchema } from './machine-capabilities.js';

/** per-runtime 开关词表（spec 11 A8/A9 单源：machine.enabledRuntimes 元素、
 * PATCH body、machines 页 switch data-runtime、providers tab runtime 同词表；
 * Codex 后续票再扩，spec 11 A1）。 */
export const MACHINE_RUNTIMES = ['pi', 'claude-code'] as const;
export type MachineRuntime = (typeof MACHINE_RUNTIMES)[number];

export const machineRecordSchema = z.object({
  /** machineId（r3 §1.2 观测形 `TlZ2sSD4EJCxjNJqVhdo_`；server 记录键名
   * [推断]）。 */
  id: recordId,
  /** pacman start --name 默认 hostname（r3 §1.1）；机器页显示样 `r3-mbp 离线
   * …NJqVhdo_ · max 3`（r3 §1.2）。 */
  name: z.string(),
  teamId: recordId,
  /** presence（02 §1.2 machine_presence 事件 {machineId, online}）。 */
  online: z.boolean(),
  /** 机器页数据含 latestCliVersion（r5 §8 实测 "0.1.53"）；用于 MCP/记忆等
   * 版本墙提示（02 §7.1/§8）。 */
  latestCliVersion: z.string().nullable(),
  /** 本机 vs 接入机（spec 11 A9）：server 启动 seed / hostname 匹配的 enroll
   * 落 'local'，其余恒 'remote'；本机行钉 machines 页列表首且不可删（A8）。 */
  kind: z.enum(['local', 'remote']),
  /** per-runtime 开关态（spec 11 A9）：默认 [] = 全关；machines 页 switch
   * PATCH 写回。读侧宽（string[]，spec 11 模块清单原文）、写侧严
   * （patchMachineBodySchema 钉 MACHINE_RUNTIMES enum）——词表演进时旧库
   * 行仍可读出，入口恒收严。 */
  enabledRuntimes: z.array(z.string()),
  /** 机器层 shell 访问闸（XMON-108 R1，UI 承诺文案 agent.ts「远程 shell」
   * 副文案的本体）：与 agent 层「远程 shell」开关联合判定（双闸齐开才有
   * remote_shell，见 claimedStepSchema.localTools）。默认 false（存量行
   * migration 回填）——「机器 shell 权限改动秒级热加载」由每调用预检兑现
   * （POST /api/machine/shell/{stepId} 复读本列，非 claim 期一次闸）。 */
  shellEnabled: z.boolean(),
  /** 机器并发上限（#1108）：该机同时执行的步数 N——server claim 闸 +
   * daemon 本地闸双侧消费；超过 N 的步留 pending（排队）。#1241 起未覆盖时
   * 本值是 server 按能力指纹算的推荐值（见 concurrencySource）；用户改过
   * 则以用户值为准。DB NOT NULL 默认 3。optional 形 = 加法契约：老 server
   * 响应缺该字段，消费方回退（daemon 的本地闸按 1 串行，web 不渲染并发面）；
   * server 恒发全块。 */
  maxConcurrent: z.number().int().optional(),
  /** #1241：true = 用户写过 maxConcurrent，心跳不再用推荐值覆盖。缺席 =
   *  老 server（web 不标手动/自动）。 */
  maxConcurrentOverridden: z.boolean().optional(),
  /** #1241：按当前硬件算出的推荐值（覆盖时也发，恢复自动回到这个数）。
   *  无硬件 = 保守默认。缺席 = 老 server。 */
  recommendedConcurrent: z.number().int().optional(),
  /** #1241：选择器可选区间（按总内存；无指纹 = 1..8）。PATCH 写域仍是 1..16。
   *  缺席 = 老 server（web 退回 1..8）。 */
  concurrencyRange: z.object({ min: z.number().int(), max: z.number().int() }).optional(),
  /** #1241：manual = 用户覆盖；measured = 推荐值来自硬件；estimate = 没有
   *  可用指纹，maxConcurrent 是保守默认。缺席 = 老 server。 */
  concurrencySource: z.enum(['measured', 'estimate', 'manual']).optional(),
  /** 该机当前 claimed 非 chief 步数（#1108 排队可见的机器面读数，`执行中 n/N`
   * n；#1148 起 chief 在跑不进 n——n 恒 ≤ N）：读侧派生（listSteps/claim
   * 时点计数），不落库。optional 形同 maxConcurrent——老 server 缺席时机器
   * 页不渲染该标注。 */
  runningSteps: z.number().int().optional(),
  /** 机器能力清单（#1251 / ADR 0018 决策 4.1）：daemon 经 enroll/presence
   *  上报的已装 MCP slug 集 + 本机技能名集。三态：清单 = 已上报；null =
   *  从未上报（老 daemon——机器页显示「未上报」，能力闸按未知放行）；缺席 =
   *  老 server 响应（读侧加法契约，消费面回落不渲染）。 */
  capabilities: machineCapabilitiesSchema.nullish(),
});
export type MachineRecord = z.infer<typeof machineRecordSchema>;

/** PATCH /api/machines/{id} body（spec 11 数据契约）：enabledRuntimes 全量
 * 替换语义；元素词表钉死 MACHINE_RUNTIMES（词表外 runtime = 400）。
 * XMON-108 R1 起两字段各自可选、缺省 = 不动（undefined ≠ 清空/重置）——
 * 单字段 PATCH（如 R3 机器页只翻 shellEnabled）不再被迫读改写另一字段。
 * #1108 maxConcurrent：并发上限写位（值域 1..16，越界 400；下调不抢占在
 * 飞步——两侧闸只挡新认领），缺省 = 不动。#1241：数字 = 手动覆盖并持久；
 * null = 清除覆盖，回到推荐值（无指纹则保守默认）。 */
export const patchMachineBodySchema = z.object({
  enabledRuntimes: z.array(z.enum(MACHINE_RUNTIMES)).optional(),
  shellEnabled: z.boolean().optional(),
  maxConcurrent: z.number().int().min(1).max(16).nullable().optional(),
});
export type PatchMachineBody = z.infer<typeof patchMachineBodySchema>;

/** 「添加机器」弹窗命令块（r2 11b/r3 §1.2）：安装 CLI + pacman start；底部
 * 「在云服务器上运行？改用 API key 注册」展开 --api-key --team 命令 +
 * 「获取 API key →」跳 api-keys 页。品牌串走 brand.ts 槽。 */
export const MACHINE_ADD_DIALOG_COPY = {
  cloudHint: '在云服务器上运行？改用 API key 注册',
  getKeyLink: '获取 API key →',
} as const;

/** POST /api/machines/{id}/evacuate body（#1259 整机迁移）：目标机 id。
 *  响应 = { moved: agentId[], rejected: { agentId, reason }[] }（部分迁移
 *  合法——拒的留原机由人逐项处置）。 */
export const evacuateMachineBodySchema = z.object({
  targetMachineId: recordId,
});
export type EvacuateMachineBody = z.infer<typeof evacuateMachineBodySchema>;
