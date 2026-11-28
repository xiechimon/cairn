import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AskUserQuestion,
  ImConnectionRecord,
  ImConnectionStatus,
  ImPairedSender,
  ImPairingRequestRecord,
  ImPlatform,
  ImWechatLoginPoll,
  ImWechatLoginStart,
} from '@cairn/shared';
import {
  chatBlockSchema,
  isAllowedAttachmentExt,
  SHOW_CHART_TOOL,
  SHOW_DIFF_TOOL,
} from '@cairn/shared';
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { type CommitEffects, runAfterCommit } from '../../db/commit-effects.js';
import {
  attachment,
  chiefMessage,
  coordinatorInput,
  externalEffect,
  imConnection,
  imPairingRequest,
  imSeenInbound,
  imTurnOrigin,
  notification,
  step,
} from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { newRecordId, nowMs } from '../../lib/ids.js';
import type { KeySecretBox } from '../../lib/secret-box.js';
import {
  ALWAYS_CHOICE,
  APPROVE_CHOICE,
  answerProposal,
  CARD_ENDINGS,
  type Decision,
  dispatchActionWakes,
  SEND_CHOICE,
} from '../action-proposals.js';
import { attachmentMime } from '../agent-attachments.js';
import {
  extOf,
  isValidFileName,
  validateAttachmentUpload,
  writeAttachmentFile,
} from '../attachments.js';
import {
  answerChiefQuestion,
  type ChiefDeps,
  coordinatorThreadRow,
  enqueueChiefStep,
  ensureChief,
  extractText,
} from '../chief.js';
import {
  askQuestionContentOf,
  proposalIdOfCard,
  publishQuestion,
  readQuestion,
} from '../chief-question-store.js';
import { steerWaitingChiefStep } from '../chief-turns.js';
import { wakeCoordinator } from '../coordinator-context.js';
import {
  cancelPendingEffects,
  drainEffects,
  effectDedupeKey,
  effectRegistry,
  failEffect,
  recordEffect,
  retryEffect,
  runEffectRow,
  waitEffect,
} from '../external-effects.js';
import { asSendError } from './errors.js';
import type { ImAwayNoticeInput, ImRuntimeHooks, ImStepRow } from './runtime.js';
import { slackCardBlocks } from './slack.js';
import type {
  ImAdapter,
  ImCardMessageRef,
  ImEnv,
  ImInboundAction,
  ImInboundFile,
  ImInboundMessage,
  ImOutboundMessage,
} from './types.js';

type ConnectionRow = typeof imConnection.$inferSelect;

interface LiveSession {
  send(msg: ImOutboundMessage): Promise<void>;
  settleCard?(ref: ImCardMessageRef, summary: string): Promise<void>;
  stop(): Promise<void>;
  offset?(): string | number | null;
}

export interface ImServiceDeps extends ChiefDeps {
  box: Pick<KeySecretBox, 'seal' | 'open'>;
  env: ImEnv;
  adapters: Partial<Record<ImPlatform, ImAdapter>>;
  attachmentsDir: string;
  reposDir: string;
}

export interface ImService {
  runtime: ImRuntimeHooks;
  listConnections(teamId: string): ImConnectionRecord[];
  createConnection(
    teamId: string,
    platform: ImPlatform,
    fields: Record<string, string>,
    opts?: { pairedSenders?: ImPairedSender[] },
  ): Promise<ImConnectionRecord>;
  startWechatLogin(): Promise<ImWechatLoginStart>;
  pollWechatLogin(teamId: string, loginId: string): Promise<ImWechatLoginPoll>;
  deleteConnection(teamId: string, connId: string): Promise<{ ok: true }>;
  reconnectConnection(teamId: string, connId: string): Promise<ImConnectionRecord>;
  listPairingRequests(teamId: string): ImPairingRequestRecord[];
  decidePairingRequest(
    teamId: string,
    requestId: string,
    decision: 'approved' | 'rejected',
  ): Promise<ImPairingRequestRecord>;
  resume(): Promise<void>;
  shutdown(): Promise<void>;
}

const PAIRING_REQUESTED_TEXT =
  '你的配对请求已记录：请在 Cairn 应用弹窗或「设置 → 聊天应用」里批准后，再继续对话。';
const PAIRING_APPROVED_TEXT = '已通过配对：现在可以直接在这里和 Cairn 对话。';
const TURN_FAILED_TEXT = '本轮处理失败，请稍后重试。';
const SEND_ATTEMPTS = 4;
const AWAY_NOTICE_WINDOW_MS = 10 * 60 * 1000;

interface Origin {
  connId: string;
  chatKey: string;
  senderId: string;
  threadId: string;
}

function questionCard(requestId: string, questions: readonly AskUserQuestion[]) {
  const [question] = questions;
  if (questions.length !== 1 || question === undefined || question.options.length === 0) {
    return undefined;
  }
  return {
    requestId,
    text: `${question.question}\n\n${question.options.map((o, i) => `${i + 1}. ${o.label}${o.description?.trim() ? ` — ${o.description.trim()}` : ''}`).join('\n')}`.trim(),
    buttons: [
      question.options.map((o, i) => ({ label: o.label, value: `imcb:${requestId}:${i}` })),
    ],
  };
}

function sessionOffset(session: LiveSession): string | number | null {
  return typeof session.offset === 'function' ? session.offset() : null;
}

function sendBackoffMs(attempt: number): number {
  return Math.min(5000 * 2 ** attempt, 30_000);
}

function imSendConnId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const connId = (payload as Record<string, unknown>).connId;
  return typeof connId === 'string' ? connId : null;
}

function imSendNotice(payload: unknown): { notificationId: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const notice = (payload as Record<string, unknown>).notice;
  if (typeof notice !== 'object' || notice === null) return null;
  const notificationId = (notice as Record<string, unknown>).notificationId;
  return typeof notificationId === 'string' ? { notificationId } : null;
}

function awaySubjectSeen(db: Db, subject: string, type: string, snippet: string): boolean {
  const recent = db
    .select({
      type: sql<string | null>`json_extract(${externalEffect.payload}, '$.notice.type')`,
      snippet: sql<string | null>`json_extract(${externalEffect.payload}, '$.notice.snippet')`,
    })
    .from(externalEffect)
    .where(
      and(
        eq(externalEffect.kind, 'im-send'),
        gte(externalEffect.createdAt, nowMs() - AWAY_NOTICE_WINDOW_MS),
        inArray(externalEffect.state, ['pending', 'sending', 'delivered']),
        sql`json_extract(${externalEffect.payload}, '$.notice.subject') = ${subject}`,
      ),
    )
    .all();
  return recent.some((row) => {
    if (type === 'chief_message') {
      return row.type === type ? (row.snippet ?? '') === snippet : row.type !== 'chief_message';
    }
    return row.type === type && (row.snippet ?? '') === snippet;
  });
}

function imSendButtons(raw: unknown): { label: string; value: string }[][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows: { label: string; value: string }[][] = [];
  for (const rawRow of raw) {
    if (!Array.isArray(rawRow)) return undefined;
    const row: { label: string; value: string }[] = [];
    for (const rawButton of rawRow) {
      if (typeof rawButton !== 'object' || rawButton === null) return undefined;
      const button = rawButton as Record<string, unknown>;
      if (typeof button.label !== 'string' || typeof button.value !== 'string') return undefined;
      row.push({ label: button.label, value: button.value });
    }
    if (row.length === 0) return undefined;
    rows.push(row);
  }
  return rows.length === 0 ? undefined : rows;
}

function imSendPayload(payload: unknown): { connId: string; message: ImOutboundMessage } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.connId !== 'string' || typeof raw.chatKey !== 'string') return null;
  if (typeof raw.text !== 'string') return null;
  return {
    connId: raw.connId,
    message: {
      chatKey: raw.chatKey,
      text: raw.text,
      ...(typeof raw.replyToMessageId === 'string'
        ? { replyToMessageId: raw.replyToMessageId }
        : {}),
      ...(imSendButtons(raw.buttons) !== undefined ? { buttons: imSendButtons(raw.buttons) } : {}),
    },
  };
}

export function createImService(deps: ImServiceDeps): ImService {
  const live = new Map<string, LiveSession>();
  const mixed = new Set<string>();
  const imOwnedMessageIds = new Set<string>();
  const queueChains = new Map<string, Promise<void>>();
  const sendErrors = new Map<string, string>();

  const connRow = (connId: string): ConnectionRow | undefined =>
    deps.db.select().from(imConnection).where(eq(imConnection.id, connId)).get();

  const requireConn = (teamId: string, connId: string): ConnectionRow => {
    const row = connRow(connId);
    if (row === undefined || row.teamId !== teamId) {
      throw new HttpError(404, `im connection ${connId}`);
    }
    return row;
  };

  const wechatLoginAdapter = (): Required<Pick<ImAdapter, 'loginStart' | 'loginWait'>> => {
    const adapter = deps.adapters.wechat;
    if (adapter?.loginStart === undefined || adapter.loginWait === undefined) {
      throw new HttpError(400, 'wechat qr login is not available');
    }
    return {
      loginStart: adapter.loginStart.bind(adapter),
      loginWait: adapter.loginWait.bind(adapter),
    };
  };

  const recordOf = (row: ConnectionRow): ImConnectionRecord => ({
    id: row.id,
    platform: row.platform,
    accountLabel: row.accountLabel,
    status: row.status,
    statusDetail: row.statusDetail,
    pairedSenders: row.pairedSenders,
    lastSendError: sendErrors.get(row.id) ?? null,
    createdAt: row.createdAt,
  });

  const markStatus = (connId: string, status: ImConnectionStatus, detail: string | null): void => {
    const row = connRow(connId);
    if (row === undefined) return;
    const trimmed = detail === null ? null : detail.slice(0, 500);
    if (row.status === status && row.statusDetail === trimmed) return;
    deps.db
      .update(imConnection)
      .set({ status, statusDetail: trimmed, updatedAt: nowMs() })
      .where(eq(imConnection.id, connId))
      .run();
  };

  const deliverOnce = async (
    connId: string,
    msg: ImOutboundMessage,
  ): Promise<'delivered' | 'dropped' | 'permanent' | 'failed' | 'offline'> => {
    const session = live.get(connId);
    if (session === undefined) return 'offline';
    for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt += 1) {
      try {
        await session.send(msg);
        if (live.get(connId) === session) sendErrors.delete(connId);
        return 'delivered';
      } catch (err) {
        const sendErr = asSendError(err);
        const current = live.get(connId) === session;
        if (current && sendErr.authExpired) markStatus(connId, 'expired', sendErr.message);
        if (sendErr.kind === 'drop') return 'dropped';
        if (sendErr.kind === 'permanent') {
          if (current) sendErrors.set(connId, sendErr.message);
          return 'permanent';
        }
        if (!current) return 'offline';
        if (attempt === SEND_ATTEMPTS - 1) {
          sendErrors.set(connId, sendErr.message);
          return 'failed';
        }
        await deps.env.sleep(sendErr.retryAfterMs ?? sendBackoffMs(attempt));
        if (live.get(connId) !== session) return 'offline';
      }
    }
    return 'failed';
  };

  effectRegistry.set('im-send', {
    policy: 'unsafe',
    scopeGone: (_db, effectRow) => {
      const connId = imSendConnId(effectRow.payload);
      return connId === null || connRow(connId) === undefined;
    },
    send: async (effectRow, db) => {
      const msg = imSendPayload(effectRow.payload);
      if (msg === null) throw failEffect('im-send payload is malformed');
      const notice = imSendNotice(effectRow.payload);
      if (notice !== null) {
        const seen = db
          .select({ readAt: notification.readAt })
          .from(notification)
          .where(eq(notification.id, notice.notificationId))
          .get();
        if (seen === undefined || seen.readAt !== null) return { skipped: 'seen' };
      }
      const outcome = await deliverOnce(msg.connId, msg.message);
      if (outcome === 'delivered') return { sent: true };
      if (outcome === 'offline') throw waitEffect('im session offline');
      if (outcome === 'permanent' || outcome === 'dropped')
        throw failEffect(`im send refused (${outcome})`);
      throw retryEffect('im send attempts exhausted');
    },
  });

  const enqueueSend = (
    connId: string,
    msg: ImOutboundMessage,
    scope?: {
      kind: 'step' | 'imConnection';
      id: string;
      stepId?: string;
      claimGeneration?: number;
      dedupe: string;
      slot?: string;
      requestId?: string;
      owned?: string[];
      deliveryId?: string;
      notice?: {
        subject: string;
        type: string;
        notificationId: string;
        snippet: string;
      };
      defer?: CommitEffects;
    },
  ): void => {
    const conn = connRow(connId);
    if (conn === undefined) return;
    const { row } = recordEffect(deps.db, {
      teamId: conn.teamId,
      scopeKind: scope?.kind ?? 'imConnection',
      scopeId: scope?.id ?? connId,
      stepId: scope?.stepId,
      claimGeneration: scope?.claimGeneration,
      kind: 'im-send',
      dedupeKey: effectDedupeKey(
        'im-send',
        connId,
        msg.chatKey,
        scope?.dedupe ?? '',
        ...(scope?.slot !== undefined
          ? [scope.slot]
          : [msg.text, msg.replyToMessageId ?? '', JSON.stringify(msg.buttons ?? null)]),
      ),
      payload: {
        connId,
        chatKey: msg.chatKey,
        text: msg.text,
        replyToMessageId: msg.replyToMessageId ?? null,
        buttons: msg.buttons ?? null,
        requestId: scope?.requestId ?? null,
        owned: scope?.owned ?? null,
        deliveryId: scope?.deliveryId ?? null,
        notice: scope?.notice ?? null,
      },
    });
    if (row.state !== 'pending') return;
    const dispatch = () => {
      const key = `${connId}\n${msg.chatKey}`;
      const prev = queueChains.get(key) ?? Promise.resolve();
      const next = prev
        .then(async () => {
          await runEffectRow(deps.db, effectRegistry, row.id);
        })
        .catch(() => {});
      queueChains.set(key, next);
    };
    if (scope?.defer !== undefined) runAfterCommit(scope.defer, 'imAwaySend', dispatch);
    else dispatch();
  };

  const sendToOrigin = (
    origin: Origin,
    text: string,
    stepRef: { id: string; claimedAt?: number | null },
    card?: { requestId: string; buttons: { label: string; value: string }[][]; owned: string[] },
  ): void => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    enqueueSend(
      origin.connId,
      {
        chatKey: origin.chatKey,
        text: trimmed,
        ...(card !== undefined ? { buttons: card.buttons } : {}),
      },
      {
        kind: 'step',
        id: stepRef.id,
        stepId: stepRef.id,
        ...(stepRef.claimedAt !== null && stepRef.claimedAt !== undefined
          ? { claimGeneration: stepRef.claimedAt }
          : {}),
        dedupe: `${stepRef.id}:${card?.requestId ?? ''}`,
        ...(card !== undefined ? { requestId: card.requestId, owned: card.owned } : {}),
      },
    );
    for (const id of card?.owned ?? []) imOwnedMessageIds.add(id);
  };

  const originOf = (stepId: string): Origin | undefined => {
    const row = deps.db.select().from(imTurnOrigin).where(eq(imTurnOrigin.stepId, stepId)).get();
    if (row === undefined) return undefined;
    return {
      connId: row.connId,
      chatKey: row.chatKey,
      senderId: row.senderId,
      threadId: row.threadId,
    };
  };

  const turnOwners = (stepId: string): Set<string> => {
    const owners = new Set<string>();
    const stepRow = deps.db
      .select({ ownerMessageIds: step.ownerMessageIds })
      .from(step)
      .where(eq(step.id, stepId))
      .get();
    for (const id of stepRow?.ownerMessageIds ?? []) owners.add(id);
    const inputs = deps.db
      .select({ ownerMessageIds: coordinatorInput.ownerMessageIds })
      .from(coordinatorInput)
      .where(and(eq(coordinatorInput.stepId, stepId), ne(coordinatorInput.state, 'released')))
      .all();
    for (const input of inputs) {
      for (const id of input.ownerMessageIds ?? []) owners.add(id);
    }
    return owners;
  };

  const imOwned = (id: string): boolean => {
    if (imOwnedMessageIds.has(id)) return true;
    const found = deps.db
      .select({ id: externalEffect.id })
      .from(externalEffect)
      .where(
        and(
          eq(externalEffect.kind, 'im-send'),
          sql`exists (select 1 from json_each(${externalEffect.payload}, '$.owned') where value = ${id})`,
        ),
      )
      .get();
    if (found === undefined) return false;
    imOwnedMessageIds.add(id);
    return true;
  };

  const turnIsImOnly = (stepId: string): boolean => {
    if (mixed.has(stepId)) return false;
    for (const id of turnOwners(stepId)) {
      if (!imOwned(id)) return false;
    }
    return true;
  };

  const lastAssistantText = (stepRow: ImStepRow): string | null => {
    const since = stepRow.claimedAt ?? stepRow.createdAt;
    const rows = deps.db
      .select({ content: chiefMessage.content })
      .from(chiefMessage)
      .where(
        and(
          eq(chiefMessage.threadId, stepRow.buildId),
          eq(chiefMessage.role, 'assistant'),
          gte(chiefMessage.createdAt, since),
          sql`CASE WHEN json_valid(${chiefMessage.content}) THEN json_type(${chiefMessage.content}) != 'object' ELSE 0 END`,
        ),
      )
      .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
      .limit(20)
      .all();
    for (const row of rows) {
      const text = extractText(row.content);
      if (text !== null && text.trim() !== '') return text.trim();
    }
    return null;
  };

  const blockFallbacks = (stepRow: ImStepRow): string[] => {
    const since = stepRow.claimedAt ?? stepRow.createdAt;
    const rows = deps.db
      .select({ content: chiefMessage.content })
      .from(chiefMessage)
      .where(
        and(
          eq(chiefMessage.threadId, stepRow.buildId),
          eq(chiefMessage.role, 'assistant'),
          gte(chiefMessage.createdAt, since),
          sql`json_valid(${chiefMessage.content}) AND json_extract(${chiefMessage.content}, '$.call.name') IN (${SHOW_DIFF_TOOL}, ${SHOW_CHART_TOOL})`,
        ),
      )
      .orderBy(chiefMessage.createdAt, sql`rowid`)
      .all();
    return rows.flatMap((row) => {
      const call = (row.content as { call?: { result?: unknown; isError?: boolean } } | null)?.call;
      if (call?.isError === true) return [];
      const text = extractText(call?.result);
      if (text === null) return [];
      try {
        const block = chatBlockSchema.safeParse(JSON.parse(text));
        return block.success ? [block.data.fallbackMarkdown] : [];
      } catch {
        return [];
      }
    });
  };

  const sniffExt = (bytes: Buffer): string | null => {
    const starts = (hex: string) =>
      bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
    if (starts('89504e470d0a1a0a')) return 'png';
    if (starts('ffd8ff')) return 'jpg';
    const head6 = bytes.subarray(0, 6).toString('latin1');
    if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
    if (
      bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
      bytes.subarray(8, 12).toString('latin1') === 'WEBP'
    )
      return 'webp';
    if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      for (const ch of text) {
        const code = ch.charCodeAt(0);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) return null;
      }
      return 'txt';
    } catch {
      return null;
    }
  };

  const storeInboundFile = (
    teamId: string,
    connId: string,
    file: ImInboundFile,
    index: number,
  ): { id: string; name: string } => {
    const bytes = Buffer.from(file.dataBase64 ?? '', 'base64');
    const named = isValidFileName(file.name) ? file.name : `im-file-${index}`;
    const fileName = isAllowedAttachmentExt(extOf(named))
      ? named
      : `im-file-${index}.${sniffExt(bytes) ?? 'bin'}`;
    const mimeType = attachmentMime(fileName, bytes);
    validateAttachmentUpload(
      { db: deps.db, teamId },
      { fileName, mimeType, size: bytes.length, scope: 'message' },
    );
    const id = newRecordId();
    const key = `${teamId}/${id}.${extOf(fileName)}`;
    writeAttachmentFile(deps.attachmentsDir, key, bytes);
    try {
      deps.db
        .insert(attachment)
        .values({
          id,
          teamId,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          createdBy: `im:${connId}`,
          fileName,
          mimeType,
          sizeBytes: bytes.length,
          storageKey: key,
          grantId: newRecordId(),
          scope: 'message',
          status: 'ready',
          createdAt: nowMs(),
        })
        .run();
    } catch (error) {
      rmSync(join(deps.attachmentsDir, key), { force: true });
      throw error;
    }
    return { id, name: fileName };
  };

  const inboundPrompt = (
    row: ConnectionRow,
    msg: ImInboundMessage,
    stored: { id: string; name: string }[],
    dropped: number,
  ): string => {
    const where = msg.chat.kind === 'group' ? `群聊「${msg.chat.title ?? msg.chat.key}」` : '私聊';
    const who = msg.sender.name ?? `sender ${msg.sender.id}`;
    const lines = [
      `主人通过 ${row.platform} ${where}收到 ${who} 的消息。请直接回复对方，回复会发回同一个聊天。`,
      '',
      msg.text === '' ? '（这条消息没有文字，只有下面的附件。）' : msg.text,
    ];
    if (stored.length > 0) {
      lines.push('', '对方发来的附件（用 attachment 工具打开 attachment= 的 id）：');
      for (const file of stored) lines.push(`- ${file.name} attachment=${file.id}`);
    }
    if (dropped > 0) lines.push(`（另有 ${dropped} 个附件没有取到。）`);
    return lines.join('\n');
  };

  const savePollOffset = (connId: string, offset: string | number): string | null => {
    const row = connRow(connId);
    if (row === undefined) return null;
    const value = String(offset);
    if (row.pollOffset === value) return value;
    deps.db
      .update(imConnection)
      .set({ pollOffset: value, updatedAt: nowMs() })
      .where(eq(imConnection.id, connId))
      .run();
    return value;
  };

  const persistPollOffset = (connId: string, row: ConnectionRow): void => {
    const session = live.get(connId);
    if (session === undefined) return;
    const offset = sessionOffset(session);
    if (offset === null) return;
    const saved = savePollOffset(connId, offset);
    if (saved !== null) row.pollOffset = saved;
  };

  const saveSecretField = (connId: string, key: string, value: string): void => {
    const row = connRow(connId);
    if (row === undefined) return;
    let fields: Record<string, string>;
    try {
      fields = openFields(row);
    } catch {
      return;
    }
    if (fields[key] === value) return;
    deps.db
      .update(imConnection)
      .set({
        secretCipher: deps.box.seal(JSON.stringify({ ...fields, [key]: value })),
        updatedAt: nowMs(),
      })
      .where(eq(imConnection.id, connId))
      .run();
  };

  const findPendingCardChoice = (
    connId: string,
    chatKey: string,
    text: string,
  ): { requestId: string; optionIndex: number } | null => {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    const ascii = trimmed.replace(/[０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    );
    const numMatch = /^([1-9]\d?)[.。、]?$/.exec(ascii);
    const numericIndex = numMatch === null ? null : Number(numMatch[1]) - 1;
    const normalizedLabel = trimmed.toLowerCase();
    const recentCards = deps.db
      .select({ payload: externalEffect.payload })
      .from(externalEffect)
      .where(
        and(
          eq(externalEffect.kind, 'im-send'),
          eq(externalEffect.state, 'delivered'),
          sql`json_extract(${externalEffect.payload}, '$.connId') = ${connId}`,
          sql`json_extract(${externalEffect.payload}, '$.chatKey') = ${chatKey}`,
          sql`json_extract(${externalEffect.payload}, '$.requestId') IS NOT NULL`,
        ),
      )
      .orderBy(desc(externalEffect.createdAt), sql`rowid desc`)
      .limit(5)
      .all();
    for (const effect of recentCards) {
      const requestId =
        typeof effect.payload === 'object' &&
        effect.payload !== null &&
        typeof (effect.payload as Record<string, unknown>).requestId === 'string'
          ? ((effect.payload as Record<string, unknown>).requestId as string)
          : null;
      if (requestId === null) continue;
      const card = deps.db
        .select({ content: chiefMessage.content })
        .from(chiefMessage)
        .where(eq(chiefMessage.id, requestId))
        .get();
      const content = card === undefined ? null : askQuestionContentOf(card.content);
      if (content === null || content.status !== 'pending' || content.questions.length !== 1) {
        continue;
      }
      const [question] = content.questions;
      if (question === undefined || question.options.length === 0) continue;
      if (numericIndex !== null) {
        return numericIndex >= 0 && numericIndex < question.options.length
          ? { requestId, optionIndex: numericIndex }
          : null;
      }
      const labelIndex = question.options.findIndex(
        (option) => option.label.trim().toLowerCase() === normalizedLabel,
      );
      return labelIndex >= 0 ? { requestId, optionIndex: labelIndex } : null;
    }
    return null;
  };

  const rememberInbound = (connId: string, messageId: string): boolean => {
    const res = deps.db
      .insert(imSeenInbound)
      .values({ connId, messageId, createdAt: nowMs() })
      .onConflictDoNothing()
      .run();
    if (res.changes === 0) return false;
    const cutoff = deps.db
      .select({ createdAt: imSeenInbound.createdAt })
      .from(imSeenInbound)
      .where(eq(imSeenInbound.connId, connId))
      .orderBy(desc(imSeenInbound.createdAt), desc(imSeenInbound.messageId))
      .limit(1)
      .offset(500)
      .get();
    if (cutoff !== undefined) {
      deps.db
        .delete(imSeenInbound)
        .where(
          and(
            eq(imSeenInbound.connId, connId),
            sql`${imSeenInbound.createdAt} < ${cutoff.createdAt}`,
          ),
        )
        .run();
    }
    return true;
  };

  const recordPairingRequest = (row: ConnectionRow, msg: ImInboundMessage): void => {
    const now = nowMs();
    const existing = deps.db
      .select()
      .from(imPairingRequest)
      .where(and(eq(imPairingRequest.connId, row.id), eq(imPairingRequest.senderId, msg.sender.id)))
      .get();
    if (existing !== undefined) {
      deps.db
        .update(imPairingRequest)
        .set({
          senderName: msg.sender.name,
          chatKey: msg.chat.key,
          updatedAt: now,
        })
        .where(eq(imPairingRequest.id, existing.id))
        .run();
      return;
    }
    deps.db
      .insert(imPairingRequest)
      .values({
        id: newRecordId(),
        connId: row.id,
        senderId: msg.sender.id,
        senderName: msg.sender.name,
        chatKey: msg.chat.key,
        status: 'pending',
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    enqueueSend(
      row.id,
      {
        chatKey: msg.chat.key,
        text: PAIRING_REQUESTED_TEXT,
        replyToMessageId: msg.messageId,
      },
      { kind: 'imConnection', id: row.id, dedupe: `pairing:${msg.sender.id}` },
    );
  };

  const onMessage = (connId: string, msg: ImInboundMessage): void => {
    const session = live.get(connId);
    const row = connRow(connId);
    if (session === undefined || row === undefined) return;
    persistPollOffset(connId, row);
    if (!rememberInbound(connId, msg.messageId)) return;
    const paired = row.pairedSenders.some((sender) => sender.id === msg.sender.id);
    if (!paired) {
      recordPairingRequest(row, msg);
      return;
    }
    if (msg.images.length === 0 && msg.files.length === 0 && msg.text.trim() !== '') {
      const cardChoice = findPendingCardChoice(connId, msg.chat.key, msg.text);
      if (cardChoice !== null) {
        answerCard(connId, row, {
          chat: msg.chat,
          sender: msg.sender,
          value: `imcb:${cardChoice.requestId}:${cardChoice.optionIndex}`,
          messageId: msg.messageId,
        });
        return;
      }
    }
    const stored: { id: string; name: string }[] = [];
    let dropped = 0;
    for (const [index, file] of [...msg.images, ...msg.files].entries()) {
      if (file.dataBase64 === null) {
        dropped += 1;
        continue;
      }
      try {
        stored.push(storeInboundFile(row.teamId, connId, file, index));
      } catch {
        dropped += 1;
      }
    }
    const chiefRow = ensureChief(deps, row.teamId);
    const threadRow = coordinatorThreadRow(deps, chiefRow);
    const bodyText = inboundPrompt(row, msg, stored, dropped);
    const coalescePending = () => {
      const pendingRows = deps.db
        .select()
        .from(step)
        .where(
          and(
            eq(step.buildId, threadRow.id),
            eq(step.kind, 'chief'),
            eq(step.status, 'pending'),
            isNull(step.claimedAt),
            isNull(step.holdReason),
          ),
        )
        .orderBy(asc(step.createdAt), sql`rowid`)
        .all();
      for (const candidate of pendingRows) {
        const origin = originOf(candidate.id);
        if (
          origin === undefined ||
          origin.connId !== connId ||
          origin.chatKey !== msg.chat.key ||
          !turnIsImOnly(candidate.id)
        ) {
          continue;
        }
        const updatedPrompt = candidate.prompt
          ? `${candidate.prompt}\n\n---\n\n${bodyText}`
          : bodyText;
        const updatedSaid =
          msg.text === ''
            ? candidate.ownerSaid
            : candidate.ownerSaid
              ? `${candidate.ownerSaid}\n${msg.text}`
              : msg.text;
        const res = deps.db
          .update(step)
          .set({ prompt: updatedPrompt, ownerSaid: updatedSaid })
          .where(
            and(
              eq(step.id, candidate.id),
              eq(step.status, 'pending'),
              isNull(step.claimedAt),
              isNull(step.holdReason),
            ),
          )
          .run();
        if (res.changes === 1) return true;
      }
      return false;
    };
    if (deps.db.transaction(() => coalescePending())) return;
    const claimedSameOrigin = deps.db
      .select()
      .from(step)
      .where(
        and(eq(step.buildId, threadRow.id), eq(step.kind, 'chief'), eq(step.status, 'claimed')),
      )
      .all()
      .find((candidate) => {
        const origin = originOf(candidate.id);
        return (
          origin !== undefined &&
          origin.connId === connId &&
          origin.chatKey === msg.chat.key &&
          turnIsImOnly(candidate.id)
        );
      });
    const stepId = enqueueChiefStep(deps, threadRow.id, {
      prompt: bodyText,
      trigger: 'wake',
      provenance: `im:${row.platform}:${connId}:${msg.chat.key}`,
      ownerMessageIds: [],
      deferWake: claimedSameOrigin !== undefined,
    });
    if (msg.text !== '')
      deps.db.update(step).set({ ownerSaid: msg.text }).where(eq(step.id, stepId)).run();
    deps.db
      .insert(imTurnOrigin)
      .values({
        stepId,
        connId,
        chatKey: msg.chat.key,
        senderId: msg.sender.id,
        threadId: threadRow.id,
        createdAt: nowMs(),
      })
      .onConflictDoNothing()
      .run();
    if (claimedSameOrigin !== undefined) {
      const waiting = deps.db.select().from(step).where(eq(step.id, stepId)).get();
      const liveRunning = deps.db
        .select()
        .from(step)
        .where(and(eq(step.id, claimedSameOrigin.id), eq(step.status, 'claimed')))
        .get();
      const steered =
        waiting !== undefined &&
        liveRunning !== undefined &&
        steerWaitingChiefStep(deps, {
          teamId: row.teamId,
          threadId: threadRow.id,
          running: liveRunning,
          waiting,
          content: waiting.prompt ?? bodyText,
          markSteered: false,
        });
      if (!steered) {
        deps.machineHub?.wake(row.teamId);
        wakeCoordinator(threadRow.id);
      }
    }
  };

  const onStatus = (connId: string, status: ImConnectionStatus, detail?: string): void => {
    markStatus(connId, status, detail ?? null);
  };

  const imCallback = (value: string): { requestId: string; optionIndex: number } | null => {
    const m = /^imcb:(.+):(\d+)$/.exec(value);
    if (m === null) return null;
    const optionIndex = Number(m[2]);
    if (!Number.isInteger(optionIndex) || optionIndex < 0) return null;
    return { requestId: m[1] ?? '', optionIndex };
  };

  const attachOrigin = (
    connId: string,
    action: ImInboundAction,
    threadId: string,
    stepId: string,
  ): void => {
    deps.db
      .insert(imTurnOrigin)
      .values({
        stepId,
        connId,
        chatKey: action.chat.key,
        senderId: action.sender.id,
        threadId,
        createdAt: nowMs(),
      })
      .onConflictDoNothing()
      .run();
  };

  const cardDecision = (label: string): Decision =>
    label === APPROVE_CHOICE || label === SEND_CHOICE
      ? 'allow-once'
      : label === ALWAYS_CHOICE
        ? 'always'
        : 'refuse';

  const settleCardUi = (connId: string, action: ImInboundAction, summary: string): void => {
    if (action.cardMessage === undefined) return;
    void live
      .get(connId)
      ?.settleCard?.(action.cardMessage, summary)
      .catch(() => {});
  };

  const stepAlreadySentToIm = (stepId: string): boolean =>
    deps.db
      .select({ id: externalEffect.id })
      .from(externalEffect)
      .where(and(eq(externalEffect.kind, 'im-send'), eq(externalEffect.stepId, stepId)))
      .get() !== undefined;

  const answerCard = (connId: string, row: ConnectionRow, action: ImInboundAction): void => {
    const parsed = imCallback(action.value);
    if (parsed === null) return;
    const delivered = deps.db
      .select({ id: externalEffect.id })
      .from(externalEffect)
      .where(
        and(
          eq(externalEffect.kind, 'im-send'),
          eq(externalEffect.state, 'delivered'),
          sql`json_extract(${externalEffect.payload}, '$.connId') = ${connId}`,
          sql`json_extract(${externalEffect.payload}, '$.requestId') = ${parsed.requestId}`,
        ),
      )
      .get();
    if (delivered === undefined) return;
    const card = deps.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, parsed.requestId))
      .get();
    const content = card === undefined ? null : askQuestionContentOf(card.content);
    if (card === undefined || content === null) return;
    if (content.status !== 'pending' || content.questions.length !== 1) {
      settleCardUi(connId, action, '已处理');
      enqueueSend(
        connId,
        { chatKey: action.chat.key, text: '这条消息已经处理过了。' },
        {
          kind: 'imConnection',
          id: connId,
          dedupe: `card-stale:${parsed.requestId}:${action.sender.id}`,
        },
      );
      return;
    }
    const option = content.questions[0]?.options[parsed.optionIndex];
    if (option === undefined) return;
    const chat = { chatKey: action.chat.key };
    const proposalId = proposalIdOfCard(content);
    if (proposalId !== null) {
      try {
        const result = answerProposal(
          { ...deps, reposDir: deps.reposDir },
          {
            proposalId,
            teamId: row.teamId,
            decision: cardDecision(option.label),
            decidedBy: `im:${action.sender.id}`,
            viaCard: true,
            interactive: 'im',
          },
        );
        settleCardUi(connId, action, `已选择：${option.label}`);
        enqueueSend(
          connId,
          { ...chat, text: CARD_ENDINGS[result.status] || '已处理。' },
          { kind: 'imConnection', id: connId, dedupe: `card-done:${parsed.requestId}` },
        );
      } catch (error) {
        if (error instanceof HttpError) {
          settleCardUi(connId, action, '已处理');
          enqueueSend(
            connId,
            { ...chat, text: '这条审批已经处理过或失效了。' },
            { kind: 'imConnection', id: connId, dedupe: `card-fail:${parsed.requestId}` },
          );
          return;
        }
        throw error;
      } finally {
        publishQuestion(deps, card.threadId, parsed.requestId);
        dispatchActionWakes(deps);
      }
      const wake = deps.db
        .select({ id: step.id })
        .from(step)
        .where(eq(step.id, `wake:${proposalId}:${card.threadId}`))
        .get();
      if (wake !== undefined) attachOrigin(connId, action, card.threadId, wake.id);
      return;
    }
    try {
      answerChiefQuestion(deps, row.teamId, {
        threadId: card.threadId,
        requestId: parsed.requestId,
        answers: [{ header: content.questions[0]?.header ?? '', choices: [option.label] }],
      });
      settleCardUi(connId, action, `已选择：${option.label}`);
    } catch (error) {
      if (error instanceof HttpError) {
        settleCardUi(connId, action, '已处理');
        enqueueSend(
          connId,
          { ...chat, text: '这条消息已经处理过了。' },
          { kind: 'imConnection', id: connId, dedupe: `card-fail:${parsed.requestId}` },
        );
        return;
      }
      throw error;
    }
    const resumed = deps.db
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          eq(step.buildId, card.threadId),
          eq(step.kind, 'chief'),
          eq(step.status, 'pending'),
          sql`exists (select 1 from json_each(${step.ownerMessageIds}) where value = ${parsed.requestId})`,
        ),
      )
      .get();
    if (resumed !== undefined) attachOrigin(connId, action, card.threadId, resumed.id);
  };

  const onAction = (connId: string, action: ImInboundAction): void => {
    const session = live.get(connId);
    const row = connRow(connId);
    if (session === undefined || row === undefined) return;
    persistPollOffset(connId, row);
    if (!rememberInbound(connId, action.messageId)) return;
    if (!row.pairedSenders.some((sender) => sender.id === action.sender.id)) return;
    answerCard(connId, row, action);
  };

  const openFields = (row: ConnectionRow): Record<string, string> => {
    const parsed = JSON.parse(deps.box.open(row.secretCipher)) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  };

  const startConnection = async (connId: string): Promise<void> => {
    const row = connRow(connId);
    if (row === undefined) return;
    const adapter = deps.adapters[row.platform];
    if (adapter === undefined) {
      markStatus(connId, 'error', `no adapter for platform ${row.platform}`);
      return;
    }
    let fields: Record<string, string>;
    try {
      fields = openFields(row);
    } catch {
      markStatus(connId, 'error', 'stored credentials could not be opened');
      return;
    }
    if (row.pollOffset !== null && row.pollOffset !== '') {
      fields = { ...fields, pollOffset: row.pollOffset };
    }
    let session: LiveSession;
    try {
      session = await adapter.connect(
        fields,
        {
          onMessage: (msg) => onMessage(connId, msg),
          onAction: (action) => onAction(connId, action),
          onStatus: (status, detail) => onStatus(connId, status, detail),
          onOffset: (offset) => {
            savePollOffset(connId, offset);
          },
          onSecretField: (key, value) => saveSecretField(connId, key, value),
        },
        deps.env,
        { connId },
      );
    } catch (err) {
      const fresh = connRow(connId);
      if (fresh !== undefined && fresh.status !== 'expired' && fresh.status !== 'error') {
        markStatus(connId, 'error', err instanceof Error ? err.message : String(err));
      }
      return;
    }
    const fresh = connRow(connId);
    if (fresh === undefined || live.get(connId) !== undefined) {
      await session.stop().catch(() => {});
      return;
    }
    live.set(connId, session);
    void drainEffects(deps.db, effectRegistry).catch(() => {});
  };

  const noticeOrigins = (threadId: string) =>
    deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, threadId), eq(step.kind, 'chief'), eq(step.status, 'claimed')))
      .all()
      .flatMap((row) => {
        const origin = originOf(row.id);
        return origin !== undefined && turnIsImOnly(row.id) ? [{ row, origin }] : [];
      });

  const service: ImService = {
    runtime: {
      assertQuestionFits(threadId, requestId, questions): void {
        const card = questionCard(requestId, questions);
        if (
          card !== undefined &&
          noticeOrigins(threadId).some(
            ({ origin }) => connRow(origin.connId)?.platform === 'slack',
          ) &&
          slackCardBlocks(card) === null
        ) {
          throw new HttpError(
            422,
            'The question is too long for the Slack card. Ask a shorter question; send the details in an ordinary message first if needed.',
          );
        }
      },

      notice(
        threadId: string,
        text: string,
        card?: { requestId: string },
        opts?: { final?: boolean },
      ): void {
        const content = card === undefined ? null : readQuestion(deps.db, threadId, card.requestId);
        const outbound =
          card !== undefined && content?.status === 'pending'
            ? questionCard(card.requestId, content.questions)
            : undefined;
        const cardSend =
          outbound === undefined || content === null
            ? undefined
            : { ...outbound, owned: [outbound.requestId, ...(content.askedFor ?? [])] };
        for (const { row, origin } of noticeOrigins(threadId)) {
          if (cardSend === undefined && opts?.final === true && stepAlreadySentToIm(row.id))
            continue;
          sendToOrigin(origin, cardSend?.text ?? text, row, cardSend);
        }
      },

      turnFinished(stepRow: ImStepRow): void {
        if (stepRow.kind !== 'chief') return;
        const origin = originOf(stepRow.id);
        if (origin === undefined) return;
        deps.db.delete(imTurnOrigin).where(eq(imTurnOrigin.stepId, stepRow.id)).run();
        if (!turnIsImOnly(stepRow.id)) {
          mixed.add(stepRow.id);
          return;
        }
        if (stepRow.status === 'failed') {
          sendToOrigin(origin, TURN_FAILED_TEXT, stepRow);
          return;
        }
        const text = stepAlreadySentToIm(stepRow.id) ? null : lastAssistantText(stepRow);
        const reply = [...blockFallbacks(stepRow), ...(text === null ? [] : [text])];
        if (reply.length > 0) sendToOrigin(origin, reply.join('\n\n'), stepRow);
      },

      hasActiveOrigin(threadId: string): boolean {
        return noticeOrigins(threadId).length > 0;
      },

      sendAwayNotice(input: ImAwayNoticeInput): { sent: boolean; connectionId?: string } {
        const rows = deps.db
          .select()
          .from(imConnection)
          .where(and(eq(imConnection.teamId, input.teamId), eq(imConnection.status, 'ready')))
          .orderBy(desc(imConnection.updatedAt), asc(imConnection.id))
          .all();
        for (const row of rows) {
          if (!live.has(row.id) || row.pairedSenders.length === 0) continue;
          const recipient = row.pairedSenders.find(
            (sender): sender is typeof sender & { chatKey: string } =>
              sender.chatKey !== null && sender.chatKey !== '',
          );
          if (recipient === undefined) continue;
          const subject =
            input.subjectId === undefined ? `thread:${input.entityId}` : `todo:${input.subjectId}`;
          if (
            input.question === undefined &&
            awaySubjectSeen(deps.db, subject, input.type, input.body)
          ) {
            return { sent: true, connectionId: row.id };
          }
          const card =
            input.question === undefined
              ? undefined
              : questionCard(input.question.requestId, input.question.questions);
          const body = card?.text ?? input.body;
          const text = body.trim() === '' ? input.title : `${input.title}\n${body}`;
          const dedupe =
            input.question === undefined
              ? `notify-away:${input.deliveryId}`
              : `card:${input.entityId}:${input.question.requestId}`;
          enqueueSend(
            row.id,
            {
              chatKey: recipient.chatKey,
              text,
              ...(card !== undefined ? { buttons: card.buttons } : {}),
            },
            {
              kind: 'imConnection',
              id: row.id,
              dedupe,
              slot: dedupe,
              deliveryId: input.deliveryId,
              notice: {
                subject,
                type: input.type,
                notificationId: input.notificationId,
                snippet: input.body,
              },
              ...(input.question !== undefined
                ? { requestId: input.question.requestId, owned: input.question.owned }
                : {}),
              defer: input.effects,
            },
          );
          return { sent: true, connectionId: row.id };
        }
        return { sent: false };
      },
    },

    listConnections(teamId: string): ImConnectionRecord[] {
      return deps.db
        .select()
        .from(imConnection)
        .where(eq(imConnection.teamId, teamId))
        .orderBy(desc(imConnection.createdAt))
        .all()
        .map(recordOf);
    },

    async createConnection(
      teamId: string,
      platform: ImPlatform,
      fields: Record<string, string>,
      opts?: { pairedSenders?: ImPairedSender[] },
    ): Promise<ImConnectionRecord> {
      const adapter = deps.adapters[platform];
      if (adapter === undefined) {
        throw new HttpError(400, `im platform ${platform} is not available yet`);
      }
      const checked = await adapter.check(fields, { teamId });
      if (!checked.ok) throw new HttpError(400, checked.reason);
      const now = nowMs();
      const id = newRecordId();
      deps.db
        .insert(imConnection)
        .values({
          id,
          teamId,
          userId: deps.user.id,
          platform,
          accountLabel: checked.accountLabel,
          secretCipher: deps.box.seal(JSON.stringify(fields)),
          pairedSenders: opts?.pairedSenders ?? [],
          status: 'connecting',
          createdAt: now,
          updatedAt: now,
        })
        .run();
      await startConnection(id);
      const row = connRow(id);
      if (row === undefined) throw new HttpError(500, 'im connection vanished');
      return recordOf(row);
    },

    async startWechatLogin(): Promise<ImWechatLoginStart> {
      return wechatLoginAdapter().loginStart(deps.env);
    },

    async pollWechatLogin(teamId: string, loginId: string): Promise<ImWechatLoginPoll> {
      const result = await wechatLoginAdapter().loginWait(loginId, deps.env);
      if (result.status !== 'done') return result;
      const scanner = result.fields.ilinkUserId?.trim() ?? '';
      const pairedSenders: ImPairedSender[] =
        scanner === '' ? [] : [{ id: scanner, name: null, chatKey: scanner, addedAt: nowMs() }];
      const connection = await service.createConnection(teamId, 'wechat', result.fields, {
        pairedSenders,
      });
      return { status: 'done', connection };
    },

    async deleteConnection(teamId: string, connId: string): Promise<{ ok: true }> {
      requireConn(teamId, connId);
      const session = live.get(connId);
      live.delete(connId);
      sendErrors.delete(connId);
      const connOrigins = deps.db
        .select({ stepId: imTurnOrigin.stepId })
        .from(imTurnOrigin)
        .where(eq(imTurnOrigin.connId, connId))
        .all();
      for (const origin of connOrigins) mixed.add(origin.stepId);
      deps.db.delete(imTurnOrigin).where(eq(imTurnOrigin.connId, connId)).run();
      cancelPendingEffects(
        deps.db,
        and(
          eq(externalEffect.kind, 'im-send'),
          sql`json_extract(${externalEffect.payload}, '$.connId') = ${connId}`,
        ),
      );
      deps.db.delete(imPairingRequest).where(eq(imPairingRequest.connId, connId)).run();
      deps.db.delete(imConnection).where(eq(imConnection.id, connId)).run();
      if (session !== undefined) await session.stop().catch(() => {});
      return { ok: true };
    },

    async reconnectConnection(teamId: string, connId: string): Promise<ImConnectionRecord> {
      const row = requireConn(teamId, connId);
      const session = live.get(connId);
      if (session !== undefined) {
        live.delete(connId);
        await session.stop().catch(() => {});
      }
      sendErrors.delete(connId);
      markStatus(connId, 'connecting', null);
      await startConnection(row.id);
      const fresh = connRow(connId);
      if (fresh === undefined) throw new HttpError(404, `im connection ${connId}`);
      return recordOf(fresh);
    },

    listPairingRequests(teamId: string): ImPairingRequestRecord[] {
      const rows = deps.db
        .select({ request: imPairingRequest, platform: imConnection.platform })
        .from(imPairingRequest)
        .innerJoin(imConnection, eq(imPairingRequest.connId, imConnection.id))
        .where(eq(imConnection.teamId, teamId))
        .orderBy(desc(imPairingRequest.requestedAt))
        .limit(100)
        .all();
      return rows.map(({ request, platform }) => ({
        id: request.id,
        connId: request.connId,
        platform,
        senderId: request.senderId,
        senderName: request.senderName,
        chatKey: request.chatKey,
        status: request.status,
        requestedAt: request.requestedAt,
        decidedAt: request.decidedAt,
      }));
    },

    async decidePairingRequest(
      teamId: string,
      requestId: string,
      decision: 'approved' | 'rejected',
    ): Promise<ImPairingRequestRecord> {
      const found = deps.db
        .select({ request: imPairingRequest, conn: imConnection })
        .from(imPairingRequest)
        .innerJoin(imConnection, eq(imPairingRequest.connId, imConnection.id))
        .where(eq(imPairingRequest.id, requestId))
        .get();
      if (found === undefined || found.conn.teamId !== teamId) {
        throw new HttpError(404, `im pairing request ${requestId}`);
      }
      if (found.request.status !== 'pending') {
        throw new HttpError(409, 'pairing request already decided');
      }
      const now = nowMs();
      deps.db.transaction(() => {
        deps.db
          .update(imPairingRequest)
          .set({ status: decision, decidedAt: now, updatedAt: now })
          .where(eq(imPairingRequest.id, requestId))
          .run();
        if (decision === 'approved') {
          const sender: ImPairedSender = {
            id: found.request.senderId,
            name: found.request.senderName,
            chatKey: found.request.chatKey,
            addedAt: now,
          };
          const existing = found.conn.pairedSenders;
          if (!existing.some((entry) => entry.id === sender.id)) {
            deps.db
              .update(imConnection)
              .set({ pairedSenders: [...existing, sender], updatedAt: now })
              .where(eq(imConnection.id, found.conn.id))
              .run();
          }
        }
      });
      if (decision === 'approved') {
        enqueueSend(
          found.conn.id,
          {
            chatKey: found.request.chatKey,
            text: PAIRING_APPROVED_TEXT,
          },
          { kind: 'imConnection', id: found.conn.id, dedupe: `paired:${found.request.senderId}` },
        );
      }
      const row = deps.db
        .select()
        .from(imPairingRequest)
        .where(eq(imPairingRequest.id, requestId))
        .get();
      if (row === undefined) throw new HttpError(404, `im pairing request ${requestId}`);
      return {
        id: row.id,
        connId: row.connId,
        platform: found.conn.platform,
        senderId: row.senderId,
        senderName: row.senderName,
        chatKey: row.chatKey,
        status: row.status,
        requestedAt: row.requestedAt,
        decidedAt: row.decidedAt,
      };
    },

    async resume(): Promise<void> {
      const rows = deps.db
        .select()
        .from(imConnection)
        .where(inArray(imConnection.status, ['connecting', 'ready', 'degraded']))
        .all();
      for (const row of rows) {
        await startConnection(row.id).catch(() => {});
      }
      await drainEffects(deps.db, effectRegistry).catch(() => {});
    },

    async shutdown(): Promise<void> {
      const sessions = [...live.values()];
      live.clear();
      for (const session of sessions) {
        await session.stop().catch(() => {});
      }
    },
  };

  return service;
}
