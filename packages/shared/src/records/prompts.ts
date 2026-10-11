// 系统合成 prompt 词表（#612）：transcript 的 role-user wire 行不全是用户
// 的话——daemon 把任务文本（title+spec）、续轮指令与 #720 组合行（任务文本
// + 重启指令同串）、#1025 首轮 plan 契约组合行（任务文本 + 契约指令同串）记
// 进会话（runner.ts），server 把 replan/restart 反馈指令与审核材料记进会话
// （builds.ts）。呈现层（web mapTranscript）需要按本词表把
// 合成行从用户话语里择出去，否则它们以用户气泡冒名顶替（任务原文还会与描
// 述区双渲染）。写侧与过滤侧单源在此，文本逐字节即 wire 值——改任何一个
// 字符串都是改双端契约。
//
// 宣告行（MERGE_ANNOUNCEMENT / REVIEW_ANNOUNCEMENT，message.ts）不在本词表：
// 它们是要渲染的行（note 家族），不是要消失的行。

import { PLAN_FILE_NAME } from './plan.js';
import { parseReviewPromptMeta } from './review.js';
import type { StepKind } from './step.js';

/** 任务文本（daemon buildTaskPrompt 单源）：title + spec 原文，new session
 *  首轮 prompt。 */
export function buildTaskPromptText(title: string, spec: string): string {
  return `${title}\n\n${spec}`;
}

/** transcript prompt 行 id 前缀（runner.ts `user-<stepId>`，TranscriptBuffer
 *  幂等键）：wire 契约位——写侧（daemon 组 id）与过滤侧（web #667 回声行
 *  去重）单源在此，改它就是改双端契约。 */
export const TRANSCRIPT_PROMPT_ROW_ID_PREFIX = 'user-';

/** transcript prompt 行 id（daemon 写侧单源）。 */
export function transcriptPromptRowId(stepId: string): string {
  return `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}${stepId}`;
}

/** continue session 续轮指令（daemon 步 kind → prompt 单源；chief/review 走
 *  instruction 分支，本表保占位空串防 TS 缺键）。 */
export const CONTINUE_PROMPTS: Record<StepKind, string> = {
  plan: '请重新规划该任务，输出更新后的方案。',
  build: '方案已确认。请按方案执行，完成改动。',
  merge: '请把本会话分支的改动合并到默认分支。',
  chief: '',
  review: '',
};

const REPLAN_HEAD = '用户对方案提出驳回。驳回反馈：「';
const REPLAN_TAIL =
  '」。请忠实按反馈调整方案，输出更新后的 plan.md（覆盖 Context/Changes/Edge cases/Verification 四段），并在结尾一句话摘要本次调整了什么。';

/** 驳回重规划指令（server revision 分支单源）：feedback 内嵌，用户的
 *  feedback 原文另有独立 wire 行在先。 */
export function buildReplanPrompt(feedback: string): string {
  return `${REPLAN_HEAD}${feedback}${REPLAN_TAIL}`;
}

const REVIEW_REJECT_HEAD = '用户在审核关口请求修改。修改反馈：「';
const REVIEW_REJECT_TAIL =
  '」。本轮改动仍保留在会话分支上，不要丢弃既有产物：对照反馈输出更新后的 plan.md（覆盖 Context/Changes/Edge cases/Verification 四段），写清改动将如何调整；执行轮会在同一分支上继续修改。结尾一句话摘要本次调整了什么。';

/** 审核关口人肉打回的重规划指令（#701，server revision 分支 review 关口
 *  单源）：与 confirm 关口驳回（buildReplanPrompt）同族分词——审核关口的
 *  事实是改动已产出且在会话分支上，指令必须交代产物保留，否则重规划轮
 *  另起炉灶、旧改动被孤儿化（票面失败方式 3 的 prompt 半边）。 */
export function buildReviewRejectPrompt(feedback: string): string {
  return `${REVIEW_REJECT_HEAD}${feedback}${REVIEW_REJECT_TAIL}`;
}

const RESTART_HEAD = '上一轮执行失败。用户反馈：「';
const RESTART_TAIL =
  '」。请把反馈纳入本轮：涉及方案先输出更新后的 plan.md（覆盖 Context/Changes/Edge cases/Verification 四段），再忠实执行完成任务。';

/** #720 反馈内嵌上界（字符数，UTF-16 单位）：反馈原文的用户行不截断，截断
 *  只作用于指令内嵌副本（裁决正本 = issue #720 裁决评论）。 */
export const RESTART_FEEDBACK_MAX_CHARS = 4_000;

/** 失败重启指令（server restart 分支单源）：feedback 内嵌，且 feedback 原文
 *  已作为独立 wire 行落新会话首条。#720 起超长反馈截到 RESTART_FEEDBACK_MAX_CHARS
 *  ——HEAD/TAIL 形状保持（呈现层 wrappedBy 识别不受影响），代理字符对不从
 *  中间撕开。 */
export function buildRestartPrompt(feedback: string): string {
  let embedded = feedback;
  if (feedback.length > RESTART_FEEDBACK_MAX_CHARS) {
    embedded = feedback.slice(0, RESTART_FEEDBACK_MAX_CHARS);
    // 代理字符对防半切：界点落在高代理上回退一单位。
    if (/[\uD800-\uDBFF]$/.test(embedded)) embedded = embedded.slice(0, -1);
    embedded = `${embedded}……（反馈过长，已截断）`;
  }
  return `${RESTART_HEAD}${embedded}${RESTART_TAIL}`;
}

/** #720 组合 prompt（new session 重启轮投递形，裁决正本 = issue #720 裁决
 *  评论）：任务文本（title+spec）在前、指令殿后，空行分隔——新会话没有任务
 *  语境，只发指令 agent 不知道做什么；指令是「带反馈执行」的动作句，殿后拿
 *  最强注意力。写侧（daemon buildTaskPrompt）与过滤侧（web classifyUserText
 *  的组合行识别）单源在此。 */
export function composeTaskPromptWithInstruction(taskText: string, instruction: string): string {
  return `${taskText}\n\n${instruction}`;
}

const REWORK_FALLBACK_HEAD =
  '原会话不可复用，已用新会话重跑。以下是本会话的既有事实，新会话无前轮记忆，凭此重建：';

/** #1204 返工降级注入组合（daemon 续接失败回退分支单源）：continue 意图步
 *  的会话续接失败回退新会话时，首轮 prompt = #720 组合形状（任务文本 +
 *  续轮指令）+ 降级上下文——最新版方案全文与全部历史返工意见（claim 载荷
 *  reworkContext 位）。返工步的新会话里除任务与反馈外一无所知（票面缺陷二
 *  实锤：卡 #24 agent 靠读仓库现场自救，首跑踩过的坑与否决过的方案全丢）。
 *  注入不进 transcript 行（呈现面零改动——降级事实由 RESUME_FRESH_SESSION_NOTE
 *  既有行标记），消费面 = backend createSession 的首轮 prompt。两段皆空 =
 *  纯 #720 形（调用方跳过注入，此处形状兜底）。 */
export function buildReworkFallbackPrompt(args: {
  taskText: string;
  instruction: string;
  planText: string | null;
  feedbacks: string[];
}): string {
  const sections: string[] = [];
  if (args.planText !== null) {
    sections.push(`当前方案（plan.md 全文）：\n${args.planText}`);
  }
  if (args.feedbacks.length > 0) {
    const list = args.feedbacks.map((f, i) => `${i + 1}. ${f}`).join('\n');
    sections.push(`历史返工意见（按时间序，全部）：\n${list}`);
  }
  const context =
    sections.length > 0 ? `\n\n${REWORK_FALLBACK_HEAD}\n\n${sections.join('\n\n')}` : '';
  return `${composeTaskPromptWithInstruction(args.taskText, args.instruction)}${context}`;
}

/** plan 步补写指令（#113 / #703 单源）：plan 步完成而 plan.md 缺席时的自动
 *  补写轮 prompt。#703 起该指令经 claim 载荷 instruction 真的进会话（runner
 *  续轮投递），daemon 把它记成 user 行——呈现层过滤侧按本模板识别（模板行
 *  不是用户话语）。#1203 起位置无关化：写入位置由 daemon 追加的交接位置
 *  注记行（buildPlanLocationNote）承载——路径是执行机本地事实，server 侧
 *  模板无法预知。 */
export function buildPlanRewritePrompt(): string {
  return `规划步未产出 ${PLAN_FILE_NAME} 交接文件。请将方案写入 ${PLAN_FILE_NAME} 交接位置指定的文件（覆盖 Context/Changes/Edge cases/Verification 四段）再结束本步；若改动已在规划轮完成，${PLAN_FILE_NAME} 如实记录改动内容与验证方式即可。`;
}

/** 首轮 plan 步的 plan.md 契约指令（#1025 单源）：此前契约只存在于纠错
 *  提示词（补写轮 #113 / 驳回重规划 / 审核打回 / 失败重启），首个 plan 步
 *  claim 载荷 instruction 缺席 → agent 只拿到 title+spec，写不写 plan.md 全凭
 *  模型自觉（#892 实测 28 build / 0 行 plan.md 的结构性根因）。daemon
 *  buildTaskPrompt 对无 instruction 的 plan 步把本指令组合进任务文本
 *  （composeTaskPromptWithInstruction 形状）；纠错轮指令自带契约句不叠注。
 *  四段名与补写轮同族逐字对齐；呈现层过滤侧按 SYNTHETIC_EXACT 收录识别
 *  （组合行不是用户话语）。#1203 起位置无关化（见 buildPlanRewritePrompt：
 *  「工作区根目录」= local-repo 项目的 checkout 根，plan.md 落那里会被
 *  agent 提交进仓库根——#24 / PR #1201 首版实锤）。 */
export function buildPlanFirstRoundInstruction(): string {
  return `本步的交接物是 ${PLAN_FILE_NAME}：结束本步前，将方案写入 ${PLAN_FILE_NAME} 交接位置指定的文件（覆盖 Context/Changes/Edge cases/Verification 四段）。`;
}

/** #1203 交接位置注记行的头尾（写侧组装与过滤侧剥离共用的锚点）。 */
const PLAN_NOTE_HEAD = `${PLAN_FILE_NAME} 交接位置：`;
const PLAN_NOTE_TAIL = `。该位置在仓库检出之外——将方案写入此文件；不要在仓库工作区里创建 ${PLAN_FILE_NAME}，也不要把它 git add 或提交。`;

/** #1203 plan.md 交接位置注记行（daemon 投递面单源）：plan 步 prompt 尾部
 *  追加的一行——plan.md 交接物搬到 repo 检出之外（PACMAN_HOME 面
 *  `<home>/plans/<conversationId>/`），路径是执行机本地事实，由 daemon 组装
 *  后随 prompt 投递并记 wire 行。写侧（runner appendPlanLocationNote）与
 *  过滤侧（stripPlanLocationNote）单源在此。 */
export function buildPlanLocationNote(planFile: string): string {
  return `${PLAN_NOTE_HEAD}${planFile}${PLAN_NOTE_TAIL}`;
}

/** 交接位置注记行追加（幂等：注记已在场 = 原文返回——recover 面 resume
 *  prompt 已含注记时不双注）。单换行拼接：注记是指令段的收尾行，不是独立
 *  段落。 */
export function appendPlanLocationNote(prompt: string, planFile: string): string {
  return prompt.includes(PLAN_NOTE_HEAD) ? prompt : `${prompt}\n${buildPlanLocationNote(planFile)}`;
}

/** 尾部交接位置注记行剥离（过滤侧）：prompt 以 '\n' + 注记行收尾时剥掉注记，
 *  余段走模板比对——追加注记不改变合成行识别（组合行/裸指令/续轮占位句/
 *  驳回/重启全族）。非注记收尾 = 原文返回。 */
function stripPlanLocationNote(text: string): string {
  const idx = text.lastIndexOf(`\n${PLAN_NOTE_HEAD}`);
  if (idx === -1) return text;
  const note = text.slice(idx + 1);
  return wrappedBy(note, PLAN_NOTE_HEAD, PLAN_NOTE_TAIL) ? text.slice(0, idx) : text;
}

/** 开始任务编排请求（#640 / r14 §5.2：编排回合的会话 user 消息 = 总目标
 *  正本，任务原文逐字内嵌 = 稳定锚点；实体引用 [#n](todo:<id>) 走 chief
 *  正文引用族）。首行短且无 markdown——chiefThreadTitle 取首行前 12 字符做
 *  线程标题。failed 重跑带相位上下文。本行进 chief 线程渲染成用户气泡
 *  （它就是用户请求的锚，不是要过滤的合成行；classifyUserText 只管 build
 *  会话）。 */
export function buildOrchestratePrompt(todo: {
  id: string;
  seqNum: number;
  spec: string;
  failed?: boolean;
  /** 用户在任务上钉选的机器名（#682）：非空 = 附加一行机器约束，chief 裁量
   *  改派时有据（数据面强制归 claim 过滤，本行只是让约束对 chief 可见）。 */
  pinnedMachineName?: string;
}): string {
  const intent =
    todo.failed === true ? '上一轮执行失败，重新编排。' : '直接规划，并按活的类型派发执行。';
  const quoted = todo.spec
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
  const machine =
    todo.pinnedMachineName !== undefined
      ? `\n\n机器：${todo.pinnedMachineName}（用户指定本任务在该机器执行，派发时保持钉选）`
      : '';
  return `开始任务 #${todo.seqNum}\n\n编排请求：[#${todo.seqNum}](todo:${todo.id}) —— ${intent}\n\n任务原文：\n${quoted}${machine}`;
}

/** 非空续轮指令集（chief/review 的占位空串不入集——空文本行由呈现层自有
 *  规则跳过，不属「合成 prompt」语义）。#703 补写指令与 #1025 首轮契约指令
 *  为固定文本，同集收录——首轮契约组合行（任务文本前缀 + 契约余段）走
 *  classifyUserText 组合行分支整行退场。 */
const SYNTHETIC_EXACT: ReadonlySet<string> = new Set([
  ...Object.values(CONTINUE_PROMPTS).filter((v) => v !== ''),
  buildPlanRewritePrompt(),
  buildPlanFirstRoundInstruction(),
]);

function wrappedBy(text: string, head: string, tail: string): boolean {
  return text.length >= head.length + tail.length && text.startsWith(head) && text.endsWith(tail);
}

/** 模板比对（SYNTHETIC 词表全量）：CONTINUE 占位句 / replan / review-reject
 *  （#701）/ restart 模板 / 审核材料 meta。 */
function matchesSyntheticTemplates(text: string): boolean {
  return (
    SYNTHETIC_EXACT.has(text) ||
    wrappedBy(text, REPLAN_HEAD, REPLAN_TAIL) ||
    wrappedBy(text, REVIEW_REJECT_HEAD, REVIEW_REJECT_TAIL) ||
    wrappedBy(text, RESTART_HEAD, RESTART_TAIL) ||
    parseReviewPromptMeta(text) !== null
  );
}

/** 纯合成指令判定（SYNTHETIC 词表全量 + #1203 注记剥离）：plan 步投递串
 *  尾部带交接位置注记行——剥注记后比对。余段须命中模板才算合成（注记本身
 *  不构成合成判定：用户话语带注记形尾行不因此误杀）。 */
function isSyntheticInstruction(text: string): boolean {
  return matchesSyntheticTemplates(text) || matchesSyntheticTemplates(stripPlanLocationNote(text));
}

/** role-user wire 行文本的归属判定：
 *  - `task-prompt` = 任务文本（title+spec 合成，与 todo 当前值精确相等）——
 *    任务简报的重复呈现，描述区是用户原话的唯一展示面；
 *  - `synthetic` = 其余合成指令（续轮/replan/restart 模板、审核材料——审核
 *    材料首行是 review prompt meta JSON，records/review.ts 单源解析）+ 组合行
 *    （#720：任务文本前缀 + 合成指令余段同串，new session 重启轮投递形）；
 *  - `user` = 真实用户话语（steer/驳回 feedback/重启 feedback），呈现层照常
 *    渲染成用户气泡。
 *  宣告行不在此判定（见文件头）；调用方先行分流。 */
export type UserTextKind = 'task-prompt' | 'synthetic' | 'user';

export function classifyUserText(
  text: string,
  task: { title: string; spec: string },
): UserTextKind {
  // wire 行经呈现层 trim 后比对（daemon 记录的是未 trim 原文）。
  const taskText = buildTaskPromptText(task.title, task.spec).trim();
  if (text === taskText) return 'task-prompt';
  if (isSyntheticInstruction(text)) return 'synthetic';
  // #720 组合行（composeTaskPromptWithInstruction 投递形）：任务前缀剥除后
  // 余段是合成指令 → 整行退场——任务简报已有描述区、反馈已有独立用户行，
  // 组合行成气泡即双渲染。余段是用户话语（任务前缀 + 用户自己的话）则不
  // 属组合行，照常 'user'。
  if (
    taskText !== '' &&
    text.length > taskText.length &&
    text.startsWith(taskText) &&
    isSyntheticInstruction(text.slice(taskText.length).trim())
  ) {
    return 'synthetic';
  }
  return 'user';
}
