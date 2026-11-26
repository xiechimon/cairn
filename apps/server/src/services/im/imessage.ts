import { randomBytes } from 'node:crypto';
import type { MachineImEventBody, MachineStreamEvent } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { machine } from '../../db/schema.js';
import type { MachineWakeHub } from '../machine-wake-hub.js';
import { ImSendError } from './errors.js';
import type { ImAdapter, ImConnectionHandlers, ImOutboundMessage } from './types.js';

const IM_SEND_TIMEOUT_MS = 30_000;
const IM_SEND_TEXT_CHUNK = 60_000;

interface PendingSend {
  resolve(): void;
  reject(err: ImSendError): void;
  timer: ReturnType<typeof setTimeout>;
}

interface BridgeConn {
  connId: string;
  machineId: string;
  handlers: ImConnectionHandlers;
  pending: Map<string, PendingSend>;
}

export interface ImBridge {
  register(connId: string, machineId: string, handlers: ImConnectionHandlers): void;
  unregister(connId: string): void;
  connMachine(connId: string): string | undefined;
  handleEvent(connId: string, ev: MachineImEventBody): boolean;
  send(connId: string, msg: ImOutboundMessage): Promise<void>;
}

export function createImBridge(machineHub: MachineWakeHub): ImBridge {
  const conns = new Map<string, BridgeConn>();

  const push = (machineId: string, ev: MachineStreamEvent): boolean =>
    machineHub.pushIm(machineId, ev);

  machineHub.onConnect((machineId) => {
    for (const conn of conns.values()) {
      if (conn.machineId === machineId) push(machineId, { type: 'im.attach', connId: conn.connId });
    }
  });

  machineHub.onDisconnect((machineId) => {
    for (const conn of conns.values()) {
      if (conn.machineId === machineId) {
        conn.handlers.onStatus('degraded', 'imessage bridge machine is offline');
      }
    }
  });

  const failPending = (conn: BridgeConn, err: ImSendError): void => {
    for (const pending of conn.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    conn.pending.clear();
  };

  return {
    register(connId, machineId, handlers) {
      const prev = conns.get(connId);
      if (prev !== undefined) {
        failPending(prev, new ImSendError('drop', 'imessage connection re-registered'));
        conns.delete(connId);
      }
      conns.set(connId, { connId, machineId, handlers, pending: new Map() });
      if (!push(machineId, { type: 'im.attach', connId })) {
        handlers.onStatus('degraded', 'imessage bridge machine is offline');
      }
    },

    unregister(connId) {
      const conn = conns.get(connId);
      if (conn === undefined) return;
      conns.delete(connId);
      push(conn.machineId, { type: 'im.detach', connId });
      failPending(conn, new ImSendError('drop', 'imessage connection closed'));
    },

    connMachine(connId) {
      return conns.get(connId)?.machineId;
    },

    handleEvent(connId, ev) {
      const conn = conns.get(connId);
      if (conn === undefined) return false;
      if (ev.kind === 'message') {
        conn.handlers.onMessage(ev.message);
        return true;
      }
      if (ev.kind === 'action') {
        conn.handlers.onAction?.(ev.action);
        return true;
      }
      if (ev.kind === 'status') {
        conn.handlers.onStatus(ev.status, ev.detail);
        return true;
      }
      const pending = conn.pending.get(ev.sendId);
      if (pending === undefined) return true;
      clearTimeout(pending.timer);
      conn.pending.delete(ev.sendId);
      if (ev.ok) {
        pending.resolve();
      } else {
        pending.reject(
          new ImSendError(ev.errorKind ?? 'retry', ev.error ?? 'imessage send failed'),
        );
      }
      return true;
    },

    async send(connId, msg) {
      const conn = conns.get(connId);
      if (conn === undefined) {
        throw new ImSendError('permanent', 'imessage connection is not live');
      }
      const chunks: string[] = [];
      for (let i = 0; i < msg.text.length; i += IM_SEND_TEXT_CHUNK) {
        chunks.push(msg.text.slice(i, i + IM_SEND_TEXT_CHUNK));
      }
      if (chunks.length === 0) chunks.push('');
      let trackedSent: Promise<void> | null = null;
      for (let index = 0; index < chunks.length; index++) {
        const last = index === chunks.length - 1;
        const sendId = randomBytes(9).toString('base64url');
        if (last) {
          trackedSent = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              conn.pending.delete(sendId);
              reject(new ImSendError('retry', 'imessage send timed out'));
            }, IM_SEND_TIMEOUT_MS);
            conn.pending.set(sendId, { resolve, reject, timer });
          });
        }
        const pushed = push(conn.machineId, {
          type: 'im.send',
          connId,
          sendId,
          message: {
            chatKey: msg.chatKey,
            text: chunks[index] ?? '',
            ...(index === 0 && msg.replyToMessageId !== undefined
              ? { replyToMessageId: msg.replyToMessageId }
              : {}),
            ...(last && msg.buttons !== undefined ? { buttons: msg.buttons } : {}),
          },
        });
        if (!pushed) {
          const pending = conn.pending.get(sendId);
          if (pending !== undefined) {
            clearTimeout(pending.timer);
            conn.pending.delete(sendId);
          }
          throw new ImSendError('retry', 'imessage bridge machine is offline');
        }
      }
      if (trackedSent !== null) await trackedSent;
    },
  };
}

export function createImessageAdapter(deps: { db: Db; bridge: ImBridge }): ImAdapter {
  return {
    platform: 'imessage',
    async check(fields, ctx) {
      const machineId = fields.machineId?.trim() ?? '';
      if (machineId === '') return { ok: false, reason: 'machineId is required' };
      const row = deps.db
        .select({ id: machine.id, name: machine.name })
        .from(machine)
        .where(and(eq(machine.id, machineId), eq(machine.teamId, ctx?.teamId ?? '')))
        .get();
      if (row === undefined) {
        return { ok: false, reason: 'machine is not registered in this team' };
      }
      return { ok: true, accountLabel: row.name };
    },
    async connect(fields, handlers, _env, ctx) {
      const machineId = fields.machineId?.trim() ?? '';
      if (machineId === '' || ctx === undefined) {
        throw new ImSendError('permanent', 'imessage connection lacks machineId');
      }
      const machineRow = deps.db
        .select({ id: machine.id })
        .from(machine)
        .where(eq(machine.id, machineId))
        .get();
      if (machineRow === undefined) {
        throw new ImSendError('permanent', 'imessage bound machine is not registered');
      }
      deps.bridge.register(ctx.connId, machineId, handlers);
      return {
        send: (msg) => deps.bridge.send(ctx.connId, msg),
        stop: async () => {
          deps.bridge.unregister(ctx.connId);
        },
      };
    },
  };
}
