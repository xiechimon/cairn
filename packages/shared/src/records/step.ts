// step record——02 §4.2（A6 锁定）：step 队列 server 持有、机器 claim 三类步
// （规划步/执行步/合并步，r3 §1.5 观测）。wire kind 词与记录字段未采集，
// 以下为 [推断] 投影（弱证：assignment 双槽 plan/build、steps body side:"plan"、
// 合并步语义），实现期重放补采后回写 02 §11 收紧（04 §3 不判负口径）。

import { z } from 'zod';
import { skillFactSchema } from '../skill-facts.js';
import { skillInjectionSchema } from '../skill-inject.js';
import { epochMs, recordId } from './common.js';

/** 三类步（02 §4.2 中文语义名的 wire 投影 [推断]）+ `chief`（M4a [设计]：
 * Chief 回合 = 机器 step 为一手实测（r5 §3.1 daemon.log `claim step=…` →
 * `conv chief-…`），kind 词未采——自定等价物，04 §3 不判负口径）+ `review`
 * （M7 #312 / r8 §3.1：AI 审核步——额外 agent 步，daemon 不开 worktree 不产
 * 改动，emit findings；#326 占位 ack → 真 findings 演进而 kind 词不变）。 */
export const stepKindSchema = z.enum(['plan', 'build', 'merge', 'chief', 'review']);
export type StepKind = z.infer<typeof stepKindSchema>;

/** 团队密钥取用面按 step kind 收窄（02 §8 运行时层）：只有真正需要密钥的步
 * kind 收到非空授权面——规划步/审核步/总管探索步恒空（那三步不构建任何东西，
 * 多一处暴露就多一处风险）。与仓内既有的按 kind 裁剪同族（review 步不开
 * worktree、chief 步只读探索）。
 * 单源：服务端凭据解析面与 daemon 取用通道注册面共用（维护者纪律——密钥的
 * 下发形状只有一条，加第二个 backend 不必重答一次「密钥怎么送」）。 */
export const SECRET_STEP_KINDS: readonly StepKind[] = ['build', 'merge'];

export function stepTakesSecrets(kind: StepKind): boolean {
  return SECRET_STEP_KINDS.includes(kind);
}

export const stepRecordSchema = z.object({
  id: recordId, // 观测形态 base64 样（r3 §9 `claim step=3iE_…`、r5 §3.1）
  /** 所属 build（≡ conversationId，CONTEXT.md 实体等式）。 */
  buildId: recordId,
  kind: stepKindSchema,
  /** claim 到该步的机器；未领取 null [推断]。 */
  machineId: recordId.nullable(),
  createdAt: epochMs,
  // journal 状态字段（heartbeat/tool/done 生命周期，02 §5.4；recover 细节
  // [推断]）归 M2/M3 按实现展开，不预发明。
});
export type StepRecord = z.infer<typeof stepRecordSchema>;

/** journal 状态词（02 §5.4 [内部] 展开：claimed = 机器领取未收尾；
 * stopped = 用户停止钮中断（M7 #308，r9 §3.3 运行行「已取消」数据源——
 * machineDoneBody status 词表原含 stopped，此为 db/读面对位补齐）。
 * waiting_quota = #1261 配额挂起：daemon 上报 quotaBlock 后 server 侧挂起
 * （不判死、不发机器信号——探测到期 sweep 释放回 pending 自动续跑）。 */
export const stepStatusSchema = z.enum([
  'pending',
  'claimed',
  'done',
  'failed',
  'stopped',
  'waiting_quota',
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

/** #1261 等额度读面投影（stepJournalRowSchema.quotaWait 与 todo record
 * quotaWait 同形——步在哪个读面，「哪一路 relay / 下次探测」只有一套口径）。
 * kind 两值对齐 quotaBlockSchema；probeAt = 下次探测时刻（sweep 释放判据）；
 * label/retryAfterMs null = 未携带（呈现层回落 providerId / 缺省窗文案）。 */
export const quotaWaitSchema = z.object({
  kind: z.enum(['quota', 'capacity']),
  providerId: z.string(),
  label: z.string().nullable(),
  retryAfterMs: z.number().int().nullable(),
  probeAt: z.number().int(),
});
export type QuotaWait = z.infer<typeof quotaWaitSchema>;

/** steps 读面/会话流 step 事件行 = record + journal 位透出 [设计]（M5 详情
 * 面进度行/分支 dialog 目标提交数据源；stepRecordSchema 最小投影不含 =
 * zod strip 下 record 对拍不漂移）。server/web 双端单源。
 * #1106 注入选择记录位：worker 步 claim 时服务端对「任务文本 × 授予技能
 * 目录」做规则选择，结果（含每条命中的规则与原因）随 claim 落本列——
 * 任务详情面据此回查「本任务注入了哪些技能、为何选中」。null = 未计算
 * （chief 步 / 旧数据）；{ hits: [] } = 已计算零命中（配置事实非故障）。 */
export const stepJournalRowSchema = stepRecordSchema.extend({
  status: stepStatusSchema,
  checkpointCommit: recordId.nullable(),
  /** 排队投影（#1108）：pending 步的「在排队、位次、等谁」——server 读侧
   *  派生（steps 查询按行计算），SSE step 事件不带（事件只报状态流转，
   *  队列细节由查询重取承载）。claimed/done 等非 pending 行缺席 = 不在
   *  排队。optional 加法契约：老 server / fixture 面缺席 = 排队呈现退
   *  化（回落既有 `处理中...` 标签），零回归。 */
  queue: z
    .object({
      /** 团队 FIFO 位次（1-based；钉选步只数该机可见集——钉同机或未钉）。 */
      position: z.number().int().min(1),
      /** 等待对象：钉选机器（含其 running/capacity 快照）；null = 未钉
       *  （等待任何在线机器）。 */
      waitingFor: z
        .object({
          machineId: recordId,
          name: z.string(),
          running: z.number().int(),
          capacity: z.number().int(),
        })
        .nullable(),
    })
    .optional(),
  skillInjection: skillInjectionSchema.nullable(),
  /** #1261 配额挂起投影：status=waiting_quota 行在位（其余缺席——zod strip
   * 下 record 对拍不漂移；老 server / fixture 面缺席 = 呈现回落既有标签，
   * 零回归）。 */
  quotaWait: quotaWaitSchema.optional(),
});
export type StepJournalRow = z.infer<typeof stepJournalRowSchema>;

/** 排队投影条目（stepJournalRowSchema.queue 的独立名，chief 线程投影
 *  （records/chief.ts turnQueue）复用同形——步在哪个读面，位次与等待对象
 *  只有一套口径）。 */
export type StepQueueInfo = NonNullable<StepJournalRow['queue']>;

/** POST /api/builds/{id}/steps body——确认回路（02 §4.2，r5 §4 实走改判）：
 * 驳回 = {action:"revision", side:"plan", feedback, clientMessageId} →
 * server 入队重规划步（同 conv continue session）→ plan v2；
 * 确认 = 同端点 {action:"confirm"}。
 * 审核 = {action:"review", agentId, focus?}（M7 #312 / r8 §3.1）：server 入队
 * 审核步（kind='review'）→ 审核中 chip + composer placeholder + 时间线发起
 * 行（REVIEW_ANNOUNCEMENT）；focus 可空（textarea 透传「关注什么」）。
 * 失败面发送 = {action:"restart", feedback, clientMessageId}（#320，
 * r9 §3.3 实测：原站 failed 态发消息触发新一轮，消息随新轮入会话；实走
 * steps 端点 body 未录——action 词与形 [设计]，语义 = 带反馈重启）。 */

export const buildStepActionBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('revision'),
    /** 观测值仅 "plan"（r5 §4 抓包）；side 词表未采齐，不收窄以外值。 */
    side: z.literal('plan'),
    feedback: z.string(),
    clientMessageId: z.string(), // <uuid>（r5 §4 抓包）
  }),
  z.object({ action: z.literal('confirm') }),
  z.object({
    action: z.literal('review'),
    /** 执行审核的 Agent id（与 chief-agent-dialog 同源 memberType:"agent" 行
     * 的 actorId）。 */
    agentId: z.string(),
    /** 可选关注点 textarea 内容；空串视为未填。 */
    focus: z.string().optional(),
  }),
  z.object({
    action: z.literal('restart'),
    /** 空消息不成发送（原站语义「发消息触发」）：直连 API 也收不住空稿。 */
    feedback: z.string().min(1),
    clientMessageId: z.string(), // <uuid>（revision 同形，r5 §4；server 侧现未消费）
  }),
]);
export type BuildStepActionBody = z.infer<typeof buildStepActionBodySchema>;

// —— 步活动相位（#905 [设计]）————————————————————————————————————————————
// 「在跑步此刻在做什么」的瞬态信号：daemon 从既有 StepEvent 流派生
// （thinking_delta / text_delta / toolcall_end / auto_retry_* / compaction_*，
// 词表零改动——01 §5 的 15 件 1:1 锁不碰），经 tool/{stepId} 第四形上报；
// server 盖 {stepId, at} 后瞬态转发到会话流 activity 事件，**不落库**——
// 与 text_delta 同纪律（02 §1.3 数据所有权不变，终稿 transcript 是内容正本）。
// 安全面（docs/verify/905/baseline.md §B）：只暴露相位事实 + 工具名 + 重试
// 轮次；thinking/text 的内容增量不走本通道。

/** 相位词表 [设计]。语义 = daemon 侧最近一次流事件所指的进行态：
 *  - preparing：claim 后、会话开启前（工作区 / 凭证 / 技能下发）；
 *  - starting：会话开启中，等模型首个事件；
 *  - thinking：思考流到达中（thinking_delta；内容不上 wire）；
 *  - responding：正文流式输出中（text_delta；文本本身走打字面可见）；
 *  - tool：调用块已流完、工具执行中（tool = 最近开始的工具名）；
 *  - retrying：协议层自动重试（attempt = 第几轮，1 起）；
 *  - compacting：上下文压缩中；
 *  - awaiting_model：工具 / 压缩 / 重试收尾后，等模型下一个事件。 */
export const STEP_ACTIVITY_PHASES = [
  'preparing',
  'starting',
  'thinking',
  'responding',
  'tool',
  'retrying',
  'compacting',
  'awaiting_model',
] as const;
export const stepActivityPhaseSchema = z.enum(STEP_ACTIVITY_PHASES);
export type StepActivityPhase = z.infer<typeof stepActivityPhaseSchema>;

/** daemon → server 上报形（machineActivityBodySchema 的载荷）。 */
export const stepActivityReportSchema = z.object({
  phase: stepActivityPhaseSchema,
  /** phase='tool' 时在位：最近开始执行的工具名（并行工具 = 最后一个开始的；
   *  终稿工具行仍经 message 事件落库，本字段只是进行态标签）。 */
  tool: z.string().optional(),
  /** phase='retrying' 时在位：auto_retry 轮次（1 起）。 */
  attempt: z.number().int().optional(),
  /** #918 技能事实（本步累计，首见序，去重按 name、denied 粘滞）：daemon 从
   *  工具调用流识别的「读了哪些技能」，被 deny 挡下的同样在列（判定源 =
   *  工具事实，分类单源 skill-facts.ts）。每份上报都携带当前累计集——hub
   *  单槽天然保住全集，订阅进场补发即拿到完整清单。缺省 = 本步尚无技能
   *  事实（旧 daemon 恒缺省，零回归）。上限见 daemon activity.ts 的
   *  SKILL_FACTS_CAP（载荷有界）。 */
  skills: z.array(skillFactSchema).optional(),
});
export type StepActivityReport = z.infer<typeof stepActivityReportSchema>;

/** 会话流 activity 事件载荷（server 盖章形）。`at` = server 收到本次上报的
 *  时刻；daemon 只在**相位变化或有新流事件到达**时上报（静默期不重发）——
 *  于是浏览器端 `now − at` 的增长即「卡住」的诚实呈现（#471 律：没有新
 *  信号就让数字涨，不伪造心跳）。时钟偏斜与既有 startedAt=step.createdAt
 *  同类（server 盖章、浏览器走表），同机部署下秒级以内。 */
export const stepActivitySchema = stepActivityReportSchema.extend({
  stepId: recordId,
  at: epochMs,
});
export type StepActivity = z.infer<typeof stepActivitySchema>;
