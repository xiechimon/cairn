// 结构化问答服务端面（#1049：ask_user 升级 + 阻塞回合 + 问答卡）。
// 状态载体 = chief_message 行本尊（无独立表）：id = requestId（幂等键，
// 重投同 id = upsert 命中同一行，不叠卡不重通知）、role = assistant（chief
// 问的）、content = JSON 串（chief_turn_error 同族，kind = ask_user_question）。
// 三条消费路径共用本模块：
// ① 机器面 POST /api/machine/ask/{stepId}（daemon 阻塞等待的主通道，hold 长轮询）；
// ② web 答题面 POST /api/teams/{id}/chief/threads/{tid}/questions/{requestId}/answer|cancel；
// ③ 步终态收口（finishStep chief 分支 + sweepAbandonedChiefSteps）——pending 问题
//   随步终态翻 cancelled，等答的 hold 轮询随即返回（D4：挂住的回合有出口，
//   不是无限占线）。
// D3 纪律：本模块**永不**因超时把 pending 翻成任何终态——hold 到期只回
// pending（daemon 原样重发），终态只来自用户（answer/cancel）与步收口。

import {
  ASK_USER_QUESTION_KIND,
  type AskUserAnswer,
  type AskUserQuestion,
  type AskUserQuestionContent,
  askUserAnswerBodySchema,
  askUserQuestionContentSchema,
  askUserQuestionSchema,
  isChiefConversationId,
  type UserRecord,
} from '@pacman/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { agent, chief, chiefMessage, chiefThread } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { notifyChiefMessage } from './notifications.js';

export interface ChiefQuestionDeps {
  db: Db;
  /** notification 通道（create 时发 chief_message 通知——问 = 打扰面，通知
   * 与 notify_user 同族：未读徽标 + 桌面通知 + 深链开抽屉）。仅建问路径
   * 消费；收口钩子（sweep 等）可缺席。 */
  hub?: TeamStreamHub;
  /** 会话流通道（问答行落库即推 message 事件——web 卡片即时上屏/翻面；
   * 缺省 = 只落库不推流）。 */
  convHub?: ConversationStreamHub;
  /** 通知 agent 位（绑定 Agent 的名/头像；缺省回落 user 位）。仅建问路径
   * 消费。 */
  user?: UserRecord;
}

/** hold 长轮询上限（一次 POST /machine/ask 的最长挂起；到期回 pending，daemon
 * 立即重发同 requestId——节奏对齐 claim 的 ~75s）。 */
export const ASK_HOLD_MS = 70_000;

/** 答到终态的 poll 粒度（人答完到 hold 返回的最坏延迟；本地 SQLite 读，
 * 单 waiter 级开销可忽略）。 */
const ASK_POLL_MS = 400;

/** 问答行 content 解析（非本 kind / 坏形状 = null——呈现端与路由端同判）。 */
export function askQuestionContentOf(content: unknown): AskUserQuestionContent | null {
  if (typeof content !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { kind?: unknown }).kind !== ASK_USER_QUESTION_KIND
  ) {
    return null;
  }
  const row = askUserQuestionContentSchema.safeParse(parsed);
  return row.success ? row.data : null;
}

function readQuestion(db: Db, threadId: string, requestId: string): AskUserQuestionContent | null {
  const row = db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.id, requestId), eq(chiefMessage.threadId, threadId)))
    .get();
  return row === undefined ? null : askQuestionContentOf(row.content);
}

function writeQuestion(
  db: Db,
  threadId: string,
  requestId: string,
  content: AskUserQuestionContent,
  createdAt: number,
): void {
  db.insert(chiefMessage)
    .values({
      id: requestId,
      threadId,
      role: 'assistant',
      content: JSON.stringify(content),
      createdAt,
    })
    .onConflictDoUpdate({
      target: chiefMessage.id,
      set: { content: JSON.stringify(content) },
    })
    .run();
  db.update(chiefThread).set({ updatedAt: nowMs() }).where(eq(chiefThread.id, threadId)).run();
}

function publishRow(deps: ChiefQuestionDeps, threadId: string, requestId: string): void {
  const row = deps.db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.id, requestId), eq(chiefMessage.threadId, threadId)))
    .get();
  if (row === undefined) return;
  deps.convHub?.publishMessage(threadId, {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
  });
}

/** 建问（幂等，D4）：同 requestId 重投 = 返回既有行不重发通知不叠卡。
 * 新建 = 落 assistant 行 + 会话流 message 事件（卡片上屏）+ chief_message
 * 通知（未读/桌面/深链）。thread 必须是 chief 会话（`chief-` 前缀）。 */
export function createOrGetQuestion(
  deps: ChiefQuestionDeps,
  input: { threadId: string; requestId: string; questions: AskUserQuestion[] },
): { content: AskUserQuestionContent; created: boolean } {
  if (!isChiefConversationId(input.threadId)) {
    throw new HttpError(400, `thread ${input.threadId} is not a chief thread`);
  }
  const existing = readQuestion(deps.db, input.threadId, input.requestId);
  if (existing !== null) return { content: existing, created: false };
  const content: AskUserQuestionContent = {
    kind: ASK_USER_QUESTION_KIND,
    requestId: input.requestId,
    status: 'pending',
    questions: input.questions,
    answers: null,
  };
  writeQuestion(deps.db, input.threadId, input.requestId, content, nowMs());
  publishRow(deps, input.threadId, input.requestId);
  // 通知（notify_user 同族）：agent = 绑定 Agent，snippet = 首题问题文本。
  const threadRow = deps.db
    .select()
    .from(chiefThread)
    .where(eq(chiefThread.id, input.threadId))
    .get();
  const chiefRow =
    threadRow === undefined
      ? undefined
      : deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get();
  const agentRow =
    chiefRow?.agentId !== undefined && chiefRow.agentId !== null
      ? deps.db.select().from(agent).where(eq(agent.id, chiefRow.agentId)).get()
      : undefined;
  if (deps.hub !== undefined && deps.user !== undefined) {
    notifyChiefMessage(
      { db: deps.db, hub: deps.hub, user: deps.user },
      {
        threadId: input.threadId,
        message: input.questions[0]?.question ?? '',
        ...(agentRow
          ? { agent: { name: agentRow.displayName, avatarUrl: agentRow.avatarUrl } }
          : { agent: { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl } }),
      },
    );
  }
  return { content, created: true };
}

/** hold 等答（机器面主通道）：pending 期间轮询，到终态（answered/cancelled）
 * 返回 content；hold 到期仍 pending = 返回 null（daemon 原样重发同
 * requestId——幂等命中既有行）。signal 中断（daemon 断连/收线）= null。 */
export async function holdForQuestion(
  deps: ChiefQuestionDeps,
  input: { threadId: string; requestId: string; holdMs: number; signal?: AbortSignal },
): Promise<AskUserQuestionContent | null> {
  const deadline = Date.now() + Math.max(0, input.holdMs);
  for (;;) {
    if (input.signal?.aborted === true) return null;
    const content = readQuestion(deps.db, input.threadId, input.requestId);
    if (content === null || content.status !== 'pending') return content;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, ASK_POLL_MS));
  }
}

/** 答题执法（web 面）：answers 与卡上 questions 按序一一对应——选项题
 * （options 非空）收 choices ⊆ 选项 label 集 ∪ 至多一条自定义串（Steps 卡
 * 末行「其他…」的自由文本，2026-10-09 形态裁决；多选 ≥1；单选恰 1）；自由
 * 文本题（options 空）收非空 text。非 pending（已答/已取消）= 409。答毕
 * 改写行 content + 会话流 message 事件（卡片翻面）。 */
export function answerQuestion(
  deps: ChiefQuestionDeps,
  input: { threadId: string; requestId: string; answers: AskUserAnswer[] },
): AskUserQuestionContent {
  const content = readQuestion(deps.db, input.threadId, input.requestId);
  if (content === null) throw new HttpError(404, `question ${input.requestId}`);
  if (content.status !== 'pending') {
    throw new HttpError(409, `question ${input.requestId} already ${content.status}`);
  }
  if (input.answers.length !== content.questions.length) {
    throw new HttpError(
      400,
      `expected ${content.questions.length} answers, got ${input.answers.length}`,
    );
  }
  const validated: AskUserAnswer[] = input.answers.map((answer, i) => {
    const question = content.questions[i];
    if (question === undefined) throw new HttpError(400, `answer ${i} has no matching question`);
    const labels = question.options.map((o) => o.label);
    if (labels.length === 0) {
      if (answer.choices !== undefined || (answer.text ?? '').trim() === '') {
        throw new HttpError(400, `question ${i} expects a non-empty text answer`);
      }
      return { header: question.header, text: (answer.text ?? '').trim() };
    }
    if (answer.text !== undefined || answer.choices === undefined || answer.choices.length === 0) {
      throw new HttpError(400, `question ${i} expects choices`);
    }
    if (answer.choices.length > 1 && question.multiSelect !== true) {
      throw new HttpError(400, `question ${i} is single-select`);
    }
    // 「其他…」自定义串（Steps 卡末行自由文本）：用户自己的话上送为一条
    // choice——与自由文本题同信任级；至多一条（多条 = 客户端坏形，不是
    // 用户输入），label 集命中数不限。
    const custom = answer.choices.filter((choice) => !labels.includes(choice));
    if (custom.length > 1) {
      throw new HttpError(
        400,
        `question ${i}: at most one custom (其他) answer, got ${custom.length}`,
      );
    }
    return { header: question.header, choices: answer.choices };
  });
  const next: AskUserQuestionContent = { ...content, status: 'answered', answers: validated };
  writeQuestion(deps.db, input.threadId, input.requestId, next, nowMs());
  publishRow(deps, input.threadId, input.requestId);
  return next;
}

/** 取消（web 面用户主动「不答了」；步终态收口同函数）。reason 进 content
 * （机器面回给模型，告知回合为何收到 cancelled）。非 pending = no-op 幂等
 * （收口钩子与用户取消竞速时后到者安静退场）。 */
export function cancelQuestion(
  deps: ChiefQuestionDeps,
  input: { threadId: string; requestId: string; reason: string },
): void {
  const content = readQuestion(deps.db, input.threadId, input.requestId);
  if (content === null || content.status !== 'pending') return;
  const next: AskUserQuestionContent = {
    ...content,
    status: 'cancelled',
    cancelReason: input.reason,
  };
  writeQuestion(deps.db, input.threadId, input.requestId, next, nowMs());
  publishRow(deps, input.threadId, input.requestId);
}

/** 线程全部 pending 问题收口（步终态钩子：finishStep chief 分支 + 失联
 * sweep）。等答的 hold 轮询在下一次 poll 命中 cancelled 即返回。reason =
 * 终态语境（「回合已结束」/「执行机器失联」），随 content 回给模型。 */
export function cancelPendingQuestions(
  deps: ChiefQuestionDeps,
  threadId: string,
  reason: string,
): void {
  const rows = deps.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, threadId)).all();
  for (const row of rows) {
    if (row.id.startsWith('user-') || row.id.startsWith('chief-err-')) continue;
    const content = askQuestionContentOf(row.content);
    if (content === null || content.status !== 'pending') continue;
    const next: AskUserQuestionContent = { ...content, status: 'cancelled', cancelReason: reason };
    writeQuestion(deps.db, threadId, row.id, next, nowMs());
    publishRow(deps, threadId, row.id);
  }
}

/** web 答题 body 解析（routes 用）。 */
export function parseAnswerBody(raw: unknown): AskUserAnswer[] {
  return parseWith(askUserAnswerBodySchema, raw, 'body').answers;
}

/** 工具 params → 结构化问题集（chief-tools relay 路径用）：questions 数组走
 * zod 执法；旧 daemon 的 `{question: "..."}` 自由文本形回落单题自由文本
 * （旧模型按旧 schema 发参，卡照样可答）。坏形状 = 400（fail-closed，模型
 * 自纠重调）。 */
export function askUserQuestionsOfParams(params: Record<string, unknown>): AskUserQuestion[] {
  const rawQuestions = params.questions;
  if (Array.isArray(rawQuestions)) {
    const parsed = z.array(askUserQuestionSchema).min(1).max(4).safeParse(rawQuestions);
    if (!parsed.success) {
      throw new HttpError(
        400,
        `ask_user questions invalid: ${parsed.error.issues[0]?.message ?? 'shape'}`,
      );
    }
    return parsed.data;
  }
  const legacy = params.question;
  if (typeof legacy === 'string' && legacy.trim() !== '') {
    return [{ header: '问题', question: legacy, options: [] }];
  }
  throw new HttpError(400, 'ask_user expects questions[] (or legacy question string)');
}
