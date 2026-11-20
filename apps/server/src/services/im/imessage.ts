import { randomBytes } from 'node:crypto';
import type { MachineImEventBody, MachineStreamEvent } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { machine } from '../../db/schema.js';
import type { MachineWakeHub } from '../machine-wake-hub.js';
import { ImSendError } from './errors.js';
import type { ImAdapter, ImConnectionHandlers, ImOutboundMessage } from './types.js';

const IM_SEND_TIMEOUT_MS = 30_000;

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
      push(machineId, { type: 'im.attach', connId });
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
      const sendId = randomBytes(9).toString('base64url');
      const sent = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          conn.pending.delete(sendId);
          reject(new ImSendError('retry', 'imessage send timed out'));
        }, IM_SEND_TIMEOUT_MS);
        conn.pending.set(sendId, { resolve, reject, timer });
      });
      const pushed = push(conn.machineId, {
        type: 'im.send',
        connId,
        sendId,
        message: {
          chatKey: msg.chatKey,
          text: msg.text,
          ...(msg.replyToMessageId !== undefined ? { replyToMessageId: msg.replyToMessageId } : {}),
          ...(msg.buttons !== undefined ? { buttons: msg.buttons } : {}),
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
      await sent;
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
