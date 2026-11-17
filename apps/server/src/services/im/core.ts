import type {
  ImConnectionRecord,
  ImConnectionStatus,
  ImPairedSender,
  ImPairingRequestRecord,
  ImPlatform,
  ImWechatLoginPoll,
  ImWechatLoginStart,
} from '@cairn/shared';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import {
  chiefMessage,
  coordinatorInput,
  imConnection,
  imPairingRequest,
  step,
} from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { newRecordId, nowMs } from '../../lib/ids.js';
import type { KeySecretBox } from '../../lib/secret-box.js';
import {
  type ChiefDeps,
  coordinatorThreadRow,
  enqueueChiefStep,
  ensureChief,
  extractText,
} from '../chief.js';
import { asSendError } from './errors.js';
import type { ImRuntimeHooks, ImStepRow } from './runtime.js';
import type { ImAdapter, ImEnv, ImInboundMessage, ImOutboundMessage } from './types.js';

type ConnectionRow = typeof imConnection.$inferSelect;

interface LiveSession {
  send(msg: ImOutboundMessage): Promise<void>;
  stop(): Promise<void>;
}

export interface ImServiceDeps extends ChiefDeps {
  box: Pick<KeySecretBox, 'seal' | 'open'>;
  env: ImEnv;
  adapters: Partial<Record<ImPlatform, ImAdapter>>;
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
  '你的配对请求已记录：等 Cairn 主人在设置里批准之后，这里发的消息才会被处理。';
const PAIRING_APPROVED_TEXT = '已通过配对：现在可以直接在这里和 Cairn 对话。';
const TURN_FAILED_TEXT = '这一轮处理失败了，请稍后再试。';
const SEND_ATTEMPTS = 4;

interface Origin {
  connId: string;
  chatKey: string;
  senderId: string;
  threadId: string;
}

function sessionOffset(session: LiveSession): number | null {
  const probe = session as { offset?: unknown };
  return typeof probe.offset === 'function' ? (probe.offset as () => number | null)() : null;
}

function sendBackoffMs(attempt: number): number {
  return Math.min(5000 * 2 ** attempt, 30_000);
}

export function createImService(deps: ImServiceDeps): ImService {
  const live = new Map<string, LiveSession>();
  const origins = new Map<string, Origin>();
  const mixed = new Set<string>();
  const imOwnedMessageIds = new Set<string>();
  const queueChains = new Map<string, Promise<void>>();
  const sendErrors = new Map<string, string>();
  const seenInbound = new Map<string, Set<string>>();

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

  const deliver = async (connId: string, msg: ImOutboundMessage): Promise<void> => {
    const session = live.get(connId);
    if (session === undefined) return;
    for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt += 1) {
      try {
        await session.send(msg);
        sendErrors.delete(connId);
        return;
      } catch (err) {
        const sendErr = asSendError(err);
        if (sendErr.authExpired) markStatus(connId, 'expired', sendErr.message);
        if (sendErr.kind === 'drop') return;
        if (sendErr.kind === 'permanent' || attempt === SEND_ATTEMPTS - 1) {
          sendErrors.set(connId, sendErr.message);
          return;
        }
        await deps.env.sleep(sendErr.retryAfterMs ?? sendBackoffMs(attempt));
      }
    }
  };

  const enqueueSend = (connId: string, msg: ImOutboundMessage): void => {
    const key = `${connId}\n${msg.chatKey}`;
    const prev = queueChains.get(key) ?? Promise.resolve();
    const next = prev.then(() => deliver(connId, msg)).catch(() => {});
    queueChains.set(key, next);
  };

  const sendToOrigin = (origin: Origin, text: string): void => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    enqueueSend(origin.connId, { chatKey: origin.chatKey, text: trimmed });
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

  const turnIsImOnly = (stepId: string): boolean => {
    if (mixed.has(stepId)) return false;
    for (const id of turnOwners(stepId)) {
      if (!imOwnedMessageIds.has(id)) return false;
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

  const inboundPrompt = (row: ConnectionRow, msg: ImInboundMessage): string => {
    const where = msg.chat.kind === 'group' ? `群聊「${msg.chat.title ?? msg.chat.key}」` : '私聊';
    const who = msg.sender.name ?? `sender ${msg.sender.id}`;
    return `主人通过 ${row.platform} ${where}收到 ${who} 的消息。请直接回复对方，回复会发回同一个聊天。\n\n${msg.text}`;
  };

  const persistPollOffset = (connId: string, row: ConnectionRow): void => {
    const session = live.get(connId);
    if (session === undefined) return;
    const offset = sessionOffset(session);
    if (offset === null) return;
    const value = String(offset);
    if (row.pollOffset === value) return;
    deps.db
      .update(imConnection)
      .set({ pollOffset: value, updatedAt: nowMs() })
      .where(eq(imConnection.id, connId))
      .run();
    row.pollOffset = value;
  };

  const rememberInbound = (connId: string, messageId: string): boolean => {
    let seen = seenInbound.get(connId);
    if (seen === undefined) {
      seen = new Set();
      seenInbound.set(connId, seen);
    }
    if (seen.has(messageId)) return false;
    seen.add(messageId);
    if (seen.size > 500) {
      const oldest = seen.values().next();
      if (oldest.done === false) seen.delete(oldest.value);
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
    enqueueSend(row.id, {
      chatKey: msg.chat.key,
      text: PAIRING_REQUESTED_TEXT,
      replyToMessageId: msg.messageId,
    });
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
    const chiefRow = ensureChief(deps, row.teamId);
    const threadRow = coordinatorThreadRow(deps, chiefRow);
    const stepId = enqueueChiefStep(deps, threadRow.id, {
      prompt: inboundPrompt(row, msg),
      trigger: 'wake',
      provenance: `im:${row.platform}:${connId}:${msg.chat.key}`,
      ownerMessageIds: [],
    });
    origins.set(stepId, {
      connId,
      chatKey: msg.chat.key,
      senderId: msg.sender.id,
      threadId: threadRow.id,
    });
  };

  const onStatus = (connId: string, status: ImConnectionStatus, detail?: string): void => {
    markStatus(connId, status, detail ?? null);
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
          onStatus: (status, detail) => onStatus(connId, status, detail),
        },
        deps.env,
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
  };

  const service: ImService = {
    runtime: {
      notice(threadId: string, text: string): void {
        const claimed = deps.db
          .select({ id: step.id })
          .from(step)
          .where(
            and(eq(step.buildId, threadId), eq(step.kind, 'chief'), eq(step.status, 'claimed')),
          )
          .all();
        for (const row of claimed) {
          const origin = origins.get(row.id);
          if (origin !== undefined && turnIsImOnly(row.id)) {
            sendToOrigin(origin, text);
          }
        }
      },

      turnFinished(stepRow: ImStepRow): void {
        if (stepRow.kind !== 'chief') return;
        const origin = origins.get(stepRow.id);
        if (origin === undefined) return;
        origins.delete(stepRow.id);
        if (!turnIsImOnly(stepRow.id)) {
          mixed.add(stepRow.id);
          return;
        }
        if (live.get(origin.connId) === undefined) return;
        if (stepRow.status === 'failed') {
          sendToOrigin(origin, TURN_FAILED_TEXT);
          return;
        }
        const text = lastAssistantText(stepRow);
        if (text !== null) sendToOrigin(origin, text);
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
      const checked = await adapter.check(fields);
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
      seenInbound.delete(connId);
      sendErrors.delete(connId);
      for (const [stepId, origin] of origins) {
        if (origin.connId === connId) {
          origins.delete(stepId);
          mixed.add(stepId);
        }
      }
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
        enqueueSend(found.conn.id, {
          chatKey: found.request.chatKey,
          text: PAIRING_APPROVED_TEXT,
        });
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
    },

    async shutdown(): Promise<void> {
      const sessions = [...live.values()];
      live.clear();
      origins.clear();
      for (const session of sessions) {
        await session.stop().catch(() => {});
      }
    },
  };

  return service;
}
