// message record（transcript）——02 §1.3：build 的有序消息与工具调用记录，
// 经 upload-urls/<stepId> 预签名上传回传落库；transcript 是 build 的一面
// （facet），非独立可操作实体（CONTEXT.md）。
// 会话流 SSE = GET /api/conversations/{id}/stream（r3 §3.5 抓包见请求），
// 逐事件 wire 载荷未枚举，承载 02 §5.6 pi 流事件词表 [推断]，归 M3 对拍。
// role 词表与响应封套证据 = r5 §3.6（chief 会话实测；build 会话为同端点族
// conversations/{id}/messages，同形 [推断]）。

import { z } from 'zod';
import { activeRunSchema } from './chief.js';
import { epochMs, recordId } from './common.js';

/** role 词表（r5 §3.6 实测：system/user/assistant）。 */
export const messageRoleSchema = z.enum(['system', 'user', 'assistant']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

/** 消息行。system content 为 JSON 串（r5 §3.6 实测
 * `{"kind":"machine_selected","machineId":…,"name":…}`）；assistant 正文可内联
 * 实体引用（chief 会话）；载荷尾部内嵌实体上下文 map（todos 全 doc +
 * projects/skills/machines，r5 §3.6）。工具行（`> edit README.md` / `> bash
 * <完整命令>`，r3 §3.5）= pi toolcall_end 载荷（02 §5.6），wire 细形归 M3。
 * 未采字段不发明，开放形状 [推断]。 */
export const messageRecordSchema = z
  .object({
    role: messageRoleSchema,
    content: z.unknown(),
  })
  .loose();
export type MessageRecord = z.infer<typeof messageRecordSchema>;

/** transcript 消息行（r5 §3.6 封套行实测含 id/createdAt 位；conversation
 * stream message 事件同形，protocol/sse.ts）。
 * actor（#902）：过闸宣告行的动作主体 displayName（人 = 用户、chief 工具面 =
 * Chief 绑定 Agent）。仅 server 动作面写入的行携带；daemon 上传行与存量旧行
 * 为 null/缺省——呈现层回落当前用户名（旧行语义不变）。 */
export const transcriptRowSchema = messageRecordSchema.extend({
  id: recordId,
  createdAt: epochMs,
  actor: z.string().nullish(),
});
export type TranscriptRow = z.infer<typeof transcriptRowSchema>;

/** system 消息 kind 观测值（r5 §3.6；词表未采齐不收窄 [推断]）。 */
export const SYSTEM_MESSAGE_KINDS = ['machine_selected'] as const;

/** 合并宣告行 content canon（r3 §3.6 实测 `15:06 Xmon Dai 发起了合并` 的
 * 内容段；行形 [设计] = role user 纯文本，呈现层拼装时间/actor）。写入端
 * （server requestMerge）与呈现端（web transcript mapper）双端单源。 */
export const MERGE_ANNOUNCEMENT = '发起了合并';

/** AI 审核发起行 content canon（M7 #312 / r8 §3.1 实测 `23:42 Xmon Dai 发起了
 * AI 审核` 的内容段；行形 = role user 纯文本，呈现层拼装时间/actor）。写入端
 * （server applyBuildStepAction review 分支）与呈现端（web transcript mapper）
 * 双端单源。 */
export const REVIEW_ANNOUNCEMENT = '发起了 AI 审核';

/** 确认闸通过行 content canon（#902）：`steps {action:'confirm'}`（REST 人肉
 * 按闸 / chief confirm_builds / MCP confirm）落 transcript 的宣告行，与
 * MERGE/REVIEW 同族（role user 纯文本，呈现层拼装时间；actor 位记「在场的
 * 是谁」——#892 §6 建议 3：没有 actor，「闸被人按过」永远只能是推断）。
 * 写入端（server applyBuildStepAction confirm 分支）与呈现端（web transcript
 * mapper）双端单源。 */
export const CONFIRM_ANNOUNCEMENT = '通过了确认';

/** 手动/工具面 done 落地行 content canon（#902/#901/#900）：不经合并步的
 * done 落地（看板 confirm/review→done 拖拽的 PATCH phase 面、chief/MCP
 * complete_todos）落 todo 最新 build 会话的宣告行，同族行形。actor 位区分
 * 人与 agent（#892 实证：88% done 经手动改相落地且零审计）。写入端（server
 * updateTodo 闸相位分支 / transitionTodos done 落地）与呈现端（web
 * transcript mapper）双端单源。 */
export const DONE_ANNOUNCEMENT = '标记为已完成';

/** 验证步发起行 content canon（#1250）：verify 步入队时（review 关口抵达且
 * assignment.verify 槽在位）落 transcript 的宣告行，与 REVIEW_ANNOUNCEMENT 同
 * 族（role user 纯文本，呈现层拼装时间/actor）。写入端（server
 * maybeEnqueueVerifyStep）与呈现端（web transcript mapper）双端单源。 */
export const VERIFY_ANNOUNCEMENT = '发起了交付验证';

/** 拆解发起行 content canon（#1250 / ADR 0018 层 2）：chief split_todo 落库
 * 后随父会话落的宣告行（actor = 谁拆的），同族行形。写入端（server
 * todo-split createSplitTodo）与呈现端（web transcript mapper）双端单源。 */
export const SPLIT_ANNOUNCEMENT = '发起了拆解';

/** 过闸宣告行 content 全集（#902）：呈现端按本表把行折叠成 note（不是用户
 * 气泡），拼装 `${actor ?? 当前用户} ${text}`。新增宣告行必须进本表，否则
 * mapper 会把审计行渲染成用户话语。 */
export const GATE_ANNOUNCEMENTS: readonly string[] = [
  MERGE_ANNOUNCEMENT,
  REVIEW_ANNOUNCEMENT,
  CONFIRM_ANNOUNCEMENT,
  DONE_ANNOUNCEMENT,
  VERIFY_ANNOUNCEMENT,
  SPLIT_ANNOUNCEMENT,
];

/** AI 审核步完成占位 ack（M7 #312 票 A 占位 emit；#326 真 findings 上线后此
 * 常量保留作 step journal 行 / 测试 fixture 字面，不作真 wire emit 用）。 */
export const REVIEW_COMPLETE_PLACEHOLDER = 'AI 审核已完成';
/** AI 审核步收尾 verdict 消息 content kind（M7 #330，r8 §3.1 真 findings 上
 * 线）：system 角色 + content = `{"kind":"review_verdict","verdict":…}` JSON
 * 串（与 machine_selected 同族，server `applyBuildStepAction` 完成时 emit）。
 * verdict 形状 = records/review.ts reviewVerdictSchema（含 conclusion + 编号
 * findings，blocking 项触发自动修订回路）。 */
export const REVIEW_VERDICT_KIND = 'review_verdict';

/** 验证步收尾 verdict 消息 content kind（#1250）：system 角色 + content =
 * `{"kind":"verify_verdict","verdict":…}` JSON 串（REVIEW_VERDICT 同族，
 * server completeStep verify 分支 emit）。verdict 形状 = records/verify.ts
 * verifyVerdictSchema（passed + conclusion + evidence 条目）。 */
export const VERIFY_VERDICT_KIND = 'verify_verdict';

/** chief 回合失败行 content kind（#631 [设计]）：daemon chief 步失败上报的
 * errorMessage 由 server `finishStep` chief 分支落 chief_message system 行
 * （machine_selected 同族形态——content 为 JSON 串），此前该原因被整个丢弃、
 * 线程零失败痕迹。写入端（services/machines.ts）与呈现端（web mappers /
 * chief drawer + toast）双端单源；`message` = 失败原因原文（daemon
 * errorMessage，透传不加工）。 */
export const CHIEF_TURN_ERROR_KIND = 'chief_turn_error';
export const chiefTurnErrorContentSchema = z.object({
  kind: z.literal(CHIEF_TURN_ERROR_KIND),
  message: z.string(),
});
export type ChiefTurnErrorContent = z.infer<typeof chiefTurnErrorContentSchema>;

// —— 结构化问答（#1049：ask_user 升级 + 阻塞回合 + 问答卡）——————————————————

/** 问答卡 content kind（#1049 [设计]）：ask_user 的提问落 chief_message
 * assistant 行，content = JSON 串（chief_turn_error 同族）。一问一行、
 * id = `<requestId>`（幂等 upsert 键 = requestId，重投不叠卡）；答/取消由
 * 答题端点就地改写 content 的 status/answers 位并重发 message 事件。写入端
 * （services/chief-questions.ts）与呈现端（web mappers / chief drawer）双端
 * 单源消费本 schema。 */
export const ASK_USER_QUESTION_KIND = 'ask_user_question';

/** 单题形（D1：选项 + 多选 + 一次多问）。options 空 = 自由文本答（pi
 * ctx.ui.input 的映射位）；非空 = 可点选项（label + 可选 hint）。 */
export const askUserQuestionSchema = z.object({
  /** 短标题（卡上按块头渲染）。 */
  header: z.string().min(1),
  question: z.string().min(1),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .max(8),
  /** 多选（选项题；自由文本题恒单答，位被忽略）。 */
  multiSelect: z.boolean().optional(),
});
export type AskUserQuestion = z.infer<typeof askUserQuestionSchema>;

/** 单题答案：选项题 = choices（选中的 label 集，按呈现序）；自由文本题 =
 * text。两者互斥由答题端点按题形执法（选项题收 text / 文本题收 choices
 * = 400）。 */
export const askUserAnswerSchema = z
  .object({
    header: z.string(),
    choices: z.array(z.string().min(1)).optional(),
    text: z.string().optional(),
  })
  .refine((a) => (a.choices !== undefined) !== (a.text !== undefined), {
    message: 'answer carries exactly one of choices | text',
  });
export type AskUserAnswer = z.infer<typeof askUserAnswerSchema>;

/** 问答卡行 content 全形。status：pending（等答）→ answered（已答）/
 * cancelled（用户取消或步终态收口——D3：永不因超时自动拍板， cancelled 是
 * 唯一非答终态）。answers 与 status 同步改写（answered 时非 null）；
 * cancelReason 在 cancelled 时携带语境（用户主动取消 vs 步终态收口），机器
 * 面把它回给模型。 */
export const askUserQuestionContentSchema = z.object({
  kind: z.literal(ASK_USER_QUESTION_KIND),
  requestId: z.string().min(1),
  status: z.enum(['pending', 'answered', 'cancelled']),
  questions: z.array(askUserQuestionSchema).min(1).max(4),
  answers: z.array(askUserAnswerSchema).nullable(),
  cancelReason: z.string().optional(),
});
export type AskUserQuestionContent = z.infer<typeof askUserQuestionContentSchema>;

/** 答题端点 body（web → server）：answers 与卡上 questions 按序一一对应。 */
export const askUserAnswerBodySchema = z.object({
  answers: z.array(askUserAnswerSchema).min(1),
});
export type AskUserAnswerBody = z.infer<typeof askUserAnswerBodySchema>;

/** 机器问答通道请求（daemon → server，POST /api/machine/ask/{stepId}）：
 * requestId 由 daemon 生成（`ask-<uuid>`）并在整个等待循环里复用（D4 幂等
 * 键——连接断开重投同 id，server 命中既有行，不重复建卡不重复通知）。形
 * 状闸 = `ask-` 前缀（问句行 id 同值；前缀防与 `user-`/`chief-err-` 等
 * special-row id 前缀撞车）。 */
export const ASK_REQUEST_ID_PATTERN = /^ask-[0-9a-f][0-9a-f-]{7,63}$/;
export const machineAskBodySchema = z.object({
  requestId: z.string().regex(ASK_REQUEST_ID_PATTERN),
  questions: z.array(askUserQuestionSchema).min(1).max(4),
});
export type MachineAskBody = z.infer<typeof machineAskBodySchema>;

/** 机器问答通道响应：status = 行当前态；hold 到期未答 = pending（daemon 原样
 * 重发）；answered 携 answers；cancelled 携 reason（用户取消 / 步终态收口）。
 * text 字段是给模型读的工具结果串（pi customTool / claude-code MCP 工具面
 * 同一消费形），由 daemon 侧组包。 */
export const machineAskResponseSchema = z.object({
  status: z.enum(['pending', 'answered', 'cancelled']),
  requestId: z.string(),
  answers: z.array(askUserAnswerSchema).nullable(),
  reason: z.string().nullable(),
});
export type MachineAskResponse = z.infer<typeof machineAskResponseSchema>;

/** 跨机续跑降级标记 canon（#862 T1）：daemon 会话续接失败
 *（SessionNotResumable，典型 = 他机认领释放步、原会话文件不在本机）回退新
 * 会话时插 transcript system 行。写入端（daemon runner 回退面）与呈现端（web
 * transcript mapper 纯文本 system→note 路）双端单源；content 恒纯文本无花括
 * 号（花括号会被呈现端当 machine_selected 同族跳过）。 */
export const RESUME_FRESH_SESSION_NOTE = '原会话不可复用，已用新会话重跑（上下文可能不完整）';

/** transcript 续跑注记行 id（daemon 写侧单源；deterministic per step，重传
 * 覆盖不叠行——transcriptPromptRowId 同律）。 */
export function transcriptResumeNoteRowId(stepId: string): string {
  return `resume-note-${stepId}`;
}

/** #931 返工回原分支——复用轮边界 note（server restart 复用旧 build 时落旧
 * conv 的 system 行；RESUME_FRESH_SESSION_NOTE 同族：纯文本、无花括号——花括
 * 号会被呈现端当 machine_selected 同族 JSON 跳过）。文本单源：server 写侧
 * （builds.ts restart 复用分支）与测试断言消费同一份。prNumber 在位点名 PR
 * （原 PR 就地更新的事实），failureReason 承接被清空的 build.errorMessage
 * 原文（失败原因不随轮界蒸发）。 */
export function buildReworkReuseNote(input: {
  prNumber: number | null;
  prUrl: string | null;
  failureReason: string | null;
}): string {
  const pr = input.prNumber !== null ? `，更新原 PR #${input.prNumber}` : '';
  const reason = input.failureReason !== null ? `上一轮失败原因：${input.failureReason}。` : '';
  return `返工回到本分支继续${pr}。${reason}`;
}

/** #931 返工另起新分支 note（原 PR 已合并/已关闭时 restart 新建 build，落新
 * conv 的 system 行）：判定显式且可见——票面失败方式 3 /验收 4，用户能看出
 * 「为什么这次是新 PR」。branch = 新 conversationId 的分支名
 * （conversationBranch 单源同式）。 */
export function buildReworkNewBranchNote(input: {
  prNumber: number | null;
  prUrl: string | null;
  branch: string;
  outcome: 'merged' | 'closed';
}): string {
  const pr = input.prNumber !== null ? `#${input.prNumber}` : (input.prUrl ?? '');
  const tail =
    input.outcome === 'merged' ? '已合并，返工在新分支上重启' : '已关闭，返工在新分支上重启';
  return `原 PR ${pr} ${tail}（${input.branch}）。`;
}

// —— #1217 已合并 PR 守卫（note 家族：守卫生效 note + 第二张 PR 警告）——————

/** #1217 守卫生效 note（claim 面落守卫目标 build conv 的 system 行）：
 *  todo 已有 GitHub merged 真值 PR 时，后续 build 的每一步 claim 都会带守卫
 *  指令——指令被 classifyUserText 过滤出用户话语（#612 词表），板面可见性
 *  由本行承担（RESUME_FRESH_SESSION_NOTE 同族：纯文本、无花括号——花括号
 *  会被呈现端当 machine_selected 同族 JSON 跳过）。文本单源：server 写侧
 *  （machines.ts claim）与测试断言消费同一份。 */
export function buildMergedPrGuardNote(input: { prNumber: number; prUrl: string | null }): string {
  const url = input.prUrl !== null ? `（${input.prUrl}）` : '';
  return `守卫生效：本任务首 PR #${input.prNumber}${url} 已在 GitHub 合并，本轮已指示执行侧不再开新 PR（如确有改动，在会话分支上提交并推送）。`;
}

/** #1217 第二张 PR 警告 note（done 回填面落本 build conv 的 system 行）：
 *  agent 无视守卫仍开出新 PR 时（prNumber 回填且探测到同 todo 更早的 merged
 *  PR），疑似重复交付——人从板面直接看到点名双 PR 的警告，合并面 409 之外
 *  的第二道兜底。同族行形（纯文本、无花括号）。 */
export function buildSecondPrWarningNote(input: {
  prNumber: number;
  mergedPrNumber: number;
  mergedPrUrl: string | null;
}): string {
  const mergedUrl = input.mergedPrUrl !== null ? `（${input.mergedPrUrl}）` : '';
  return `警告：本轮开出了新 PR #${input.prNumber}，而本任务首 PR #${input.mergedPrNumber}${mergedUrl} 已合并——疑似重复交付，请人工复核。`;
}

/** 守卫生效 note 行 id（server 写侧单源；deterministic per build，重投覆盖
 *  不叠行——transcriptResumeNoteRowId 同律：同 build 多步 claim 各自触发时
 *  幂等）。 */
export function mergedPrGuardNoteRowId(buildId: string): string {
  return `merged-pr-guard-${buildId}`;
}

/** 第二张 PR 警告 note 行 id（同上，per build 幂等）。 */
export function secondPrWarningNoteRowId(buildId: string): string {
  return `second-pr-warn-${buildId}`;
}

/** GET /api/conversations/{id}/messages 响应封套（r5 §3.6 原样）。 */
export const conversationMessagesResponseSchema = z.object({
  messages: z.array(transcriptRowSchema),
  /** chips/steerPending/nextCursor 细形未逐一采集 [推断]（steerPending[] 为
   * 数组形观测；steer 语义 = 回合中补充说明即送，r5 §3.6）。W3 #278 起
   * build 会话分支透出单槽 pending 内容（[pending.content]）。 */
  chips: z.unknown(),
  historyEpoch: z.number().int(),
  steerPending: z.array(z.unknown()),
  activeRun: activeRunSchema,
  nextCursor: z.unknown(),
});
export type ConversationMessagesResponse = z.infer<typeof conversationMessagesResponseSchema>;

/** 取消落账标记 canon（M7 #308，r9 §3.3 运行行「已取消」）：stop 落账写
 * build.errorMessage 槽——运行历史面（meta 拼接 + failed 样式，fixtures
 * `Cancelled` 行同形）与详情 fail 行（phase-failed 门控，取消回落不触发）
 * 双端消费同源。写入端 = server applyStoppedStep；呈现端 = web mappers。 */
export const STOP_MESSAGE = '已取消';

/** POST /api/conversations/{id}/messages 的 build 会话分支 body（W3 steer，
 * 06 册 D9 / spec #277；[设计] 自设——承 chiefSendMessageBodySchema 的
 * content 位，无 threadId（目标会话在路径位））：steer = 向运行中的步补话
 * （claimed 步门 + 单槽 pending + machine 拉取-确认投递）。 */
export const buildSteerBodySchema = z.object({
  content: z.string().min(1),
});
export type BuildSteerBody = z.infer<typeof buildSteerBodySchema>;

/** POST /api/builds/{id}/stop body（M7 #308 停止钮，r9 §3.3）：discard =
 * 确认弹层「丢弃本轮修改——方案和代码回到上一个版本」勾选位（默认 true）——
 * true 时 daemon 侧 rewind worktree 到步起点 checkpoint。[设计] 端点形自设
 * （原站 stop wire 未采，r9 §5）；路径从 builds 族（merge/steps 同族）。 */
export const buildStopBodySchema = z.object({
  discard: z.boolean(),
});
export type BuildStopBody = z.infer<typeof buildStopBodySchema>;
