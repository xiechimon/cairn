import { type PhoneRow, phonePairBodySchema, phoneUsbAuthorizeBodySchema } from '@cairn/shared';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { machine, phone } from './db/schema.js';
import { HttpError, notFound, parseWith } from './lib/errors.js';
import { newRecordId, nowMs } from './lib/ids.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { requireTeam } from './routes-helpers.js';
import { isOwner } from './services/instance-owner.js';
import { managePhone } from './services/machine-computer.js';
import {
  handbackPhone,
  listPhoneActivity,
  listPhones,
  machinePairingInFlight,
  phoneRecordOf,
  sanitizePhoneName,
} from './services/phone-computer.js';

const phoneCreateBodySchema = z.union([phonePairBodySchema, phoneUsbAuthorizeBodySchema]);

export function registerPhoneRoutes(app: Hono, ctx: AppContext): void {
  const pairLocks = new Map<string, Promise<unknown>>();
  const withPairLock = async <T>(machineId: string, work: () => Promise<T>): Promise<T> => {
    const prior = pairLocks.get(machineId) ?? Promise.resolve();
    const next = prior.then(work, work);
    pairLocks.set(machineId, next);
    try {
      return await next;
    } finally {
      if (pairLocks.get(machineId) === next) pairLocks.delete(machineId);
    }
  };
  const isOwnerSession = (c: Context): boolean =>
    pairedDeviceIdOf(c) === null &&
    (ctx.authToken === null || c.get('ownerIdentity') !== undefined) &&
    isOwner(ctx.db, ctx.user.id);

  const ownedMachine = (c: Context): typeof machine.$inferSelect => {
    const id = c.req.param('id') ?? '';
    const row = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!row) throw notFound(`machine ${id}`);
    requireTeam(ctx, row.teamId);
    if (!isOwnerSession(c)) throw new HttpError(403, 'owner session required');
    return row;
  };

  const hostableMachine = (c: Context): typeof machine.$inferSelect => {
    const row = ownedMachine(c);
    if (row.kind !== 'local' || row.capabilities?.osPlatform !== 'darwin')
      throw new HttpError(409, 'phones pair through the local Mac only');
    return row;
  };

  const ownedPhone = (machineId: string, phoneId: string) => {
    const row = ctx.db
      .select()
      .from(phone)
      .where(and(eq(phone.id, phoneId), eq(phone.machineId, machineId)))
      .get();
    if (!row) throw notFound(`phone ${phoneId}`);
    return row;
  };

  app.get('/api/machines/:id/phones', (c) => {
    const row = ownedMachine(c);
    return c.json({ phones: listPhones(ctx.db, row.id) });
  });

  app.get('/api/machines/:id/phones/activity', (c) => {
    const row = ownedMachine(c);
    return c.json({ activity: listPhoneActivity(ctx.db, row) });
  });

  const dispatchPair = async (
    machineRow: typeof machine.$inferSelect,
    row: typeof phone.$inferSelect,
    body: z.infer<typeof phoneCreateBodySchema>,
  ): Promise<{ phone: PhoneRow }> => {
    const result = await managePhone(
      { db: ctx.db, hub: ctx.hub, machineHub: ctx.machineHub },
      machineRow.teamId,
      machineRow.id,
      row.id,
      'code' in body
        ? { action: 'pair', code: body.code, endpoint: body.endpoint }
        : { action: 'pair' },
    );
    const settled = ctx.db.select().from(phone).where(eq(phone.id, row.id)).get();
    const record = phoneRecordOf(settled ?? row, ctx.db);
    if (result.outcome === 'failed') throw new HttpError(409, result.error ?? 'pairing failed');
    return { phone: record };
  };

  app.post('/api/machines/:id/phones', async (c) => {
    const machineRow = hostableMachine(c);
    const body = parseWith(phoneCreateBodySchema, await c.req.json(), 'body');
    return c.json(
      await withPairLock(machineRow.id, async () => {
        if (machinePairingInFlight(ctx.db, machineRow.id)) {
          throw new HttpError(409, 'a phone pairing is already running on this machine');
        }
        const deviceId = 'code' in body ? body.endpoint : body.deviceId;
        const now = nowMs();
        const name = sanitizePhoneName(body.name?.trim() || deviceId) || deviceId;
        const existing = ctx.db
          .select()
          .from(phone)
          .where(and(eq(phone.machineId, machineRow.id), eq(phone.deviceId, deviceId)))
          .get();
        const id = existing?.id ?? newRecordId();
        if (existing === undefined) {
          ctx.db
            .insert(phone)
            .values({
              id,
              teamId: machineRow.teamId,
              machineId: machineRow.id,
              platform: 'android',
              deviceId,
              name,
              consentAt: now,
              consentedBy: ctx.user.id,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        } else {
          ctx.db
            .update(phone)
            .set({
              name,
              consentAt: now,
              consentedBy: ctx.user.id,
              lastError: null,
              updatedAt: now,
            })
            .where(eq(phone.id, id))
            .run();
        }
        const row = ctx.db.select().from(phone).where(eq(phone.id, id)).get();
        if (!row) throw notFound(`phone ${id}`);
        return await dispatchPair(machineRow, row, body);
      }),
      201,
    );
  });

  app.post('/api/machines/:id/phones/:phoneId/pair', async (c) => {
    const machineRow = hostableMachine(c);
    const row = ownedPhone(machineRow.id, c.req.param('phoneId') ?? '');
    const body = parseWith(phoneCreateBodySchema, await c.req.json(), 'body');
    return c.json(
      await withPairLock(machineRow.id, async () => {
        if (machinePairingInFlight(ctx.db, machineRow.id)) {
          throw new HttpError(409, 'a phone pairing is already running on this machine');
        }
        ctx.db
          .update(phone)
          .set({ lastError: null, updatedAt: nowMs() })
          .where(eq(phone.id, row.id))
          .run();
        return await dispatchPair(machineRow, { ...row, lastError: null }, body);
      }),
    );
  });

  app.delete('/api/machines/:id/phones/:phoneId', async (c) => {
    const machineRow = ownedMachine(c);
    const row = ownedPhone(machineRow.id, c.req.param('phoneId') ?? '');
    const result = await managePhone(
      { db: ctx.db, hub: ctx.hub, machineHub: ctx.machineHub },
      machineRow.teamId,
      machineRow.id,
      row.id,
      { action: 'forget' },
    );
    return c.json({ outcome: result.outcome });
  });

  app.post('/api/machines/:id/phones/:phoneId/handback', (c) => {
    const machineRow = ownedMachine(c);
    const row = ownedPhone(machineRow.id, c.req.param('phoneId') ?? '');
    return c.json({ ok: handbackPhone(ctx.db, row.id) });
  });

  app.get('/api/phones/handoffs', (c) => {
    if (!isOwnerSession(c)) throw new HttpError(403, 'owner session required');
    const rows = ctx.db
      .select()
      .from(phone)
      .where(and(eq(phone.teamId, ctx.team.id), isNotNull(phone.handoffReason)))
      .all();
    return c.json({
      handoffs: rows.map((row) => ({
        phoneId: row.id,
        machineId: row.machineId,
        name: row.name,
        requestedAt: row.handoffRequestedAt,
      })),
    });
  });
}
