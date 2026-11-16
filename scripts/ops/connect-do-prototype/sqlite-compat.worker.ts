import { DurableObject } from 'cloudflare:workers';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import {
  acquireLease,
  type Lease,
  LeaseHeldError,
} from '../../../apps/server/src/coordinator/lease.js';
import * as schema from '../../../apps/server/src/db/schema.js';

interface Input {
  operation: string;
  id: string;
  machineId: string;
  now: number;
}

interface Environment {
  SCHEMA: string;
  DATABASE: DurableObjectNamespace;
}

export class SqliteCompatibility extends DurableObject<Environment> {
  private db;
  private leases = new Map<string, Lease>();
  private leaseNow = 0;

  constructor(ctx: DurableObjectState, env: Environment) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS cf_fixture_version (version INTEGER)');
    if (ctx.storage.sql.exec('SELECT version FROM cf_fixture_version').toArray().length === 0) {
      ctx.storage.transactionSync(() => {
        for (const statement of JSON.parse(env.SCHEMA)) ctx.storage.sql.exec(statement);
        ctx.storage.sql.exec('INSERT INTO cf_fixture_version VALUES (1)');
      });
    }
    this.db = drizzle(ctx.storage, { schema });
  }

  async fetch(request: Request): Promise<Response> {
    const input = (await request.json()) as Input;
    const db = this.db;
    if (input.operation.startsWith('lease-')) {
      this.leaseNow = input.now;
      const key = JSON.stringify([input.id, input.machineId]);
      if (input.operation === 'lease-acquire') {
        try {
          const lease = acquireLease(db, input.id, input.machineId, {
            now: () => this.leaseNow,
          });
          this.leases.set(key, lease);
          return Response.json({ acquired: true });
        } catch (error) {
          if (!(error instanceof LeaseHeldError)) throw error;
          return Response.json({ acquired: false });
        }
      }
      if (input.operation === 'lease-read') {
        return Response.json(
          db
            .select()
            .from(schema.coordinatorLease)
            .where(eq(schema.coordinatorLease.storeKey, input.id))
            .get() ?? null,
        );
      }
      const lease = this.leases.get(key);
      if (lease === undefined) return new Response(null, { status: 404 });
      if (input.operation === 'lease-heartbeat') return Response.json({ owned: lease.heartbeat() });
      if (input.operation === 'lease-release') {
        lease.release();
        return Response.json({ released: true });
      }
    }
    if (input.operation === 'seed') {
      db.insert(schema.team).values({ id: 'owner', name: 'Personal', createdAt: 1 }).run();
      db.insert(schema.machine)
        .values([
          { id: 'alpha', teamId: 'owner', name: 'Alpha', online: true, enabledRuntimes: ['pi'] },
          { id: 'beta', teamId: 'owner', name: 'Beta', online: false, enabledRuntimes: [] },
        ])
        .run();
      db.insert(schema.step)
        .values([
          { id: 'available', buildId: 'build', kind: 'build', createdAt: 1 },
          { id: 'held', buildId: 'build', kind: 'build', createdAt: 2, holdUntil: 1_001 },
        ])
        .run();
      return Response.json({ seeded: true });
    }
    if (input.operation === 'mapping') {
      return Response.json({
        machines: db.select().from(schema.machine).orderBy(schema.machine.id).all(),
        step: db.select().from(schema.step).where(eq(schema.step.id, 'available')).get(),
        missing: db.select().from(schema.step).where(eq(schema.step.id, 'absent')).get() ?? null,
      });
    }
    if (input.operation === 'claim') {
      const winner = db.transaction((tx) =>
        tx
          .update(schema.step)
          .set({
            status: 'claimed',
            machineId: input.machineId,
            claimedAt: input.now,
            lastHeartbeatAt: input.now,
          })
          .where(
            and(
              eq(schema.step.id, input.id),
              eq(schema.step.status, 'pending'),
              or(isNull(schema.step.holdUntil), lte(schema.step.holdUntil, input.now)),
            ),
          )
          .returning({ id: schema.step.id, machineId: schema.step.machineId })
          .get(),
      );
      return Response.json({ winner: winner ?? null });
    }
    if (input.operation === 'rollback') {
      try {
        db.transaction((tx) => {
          tx.update(schema.machine).set({ name: 'must roll back' }).run();
          throw new Error('rollback probe');
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'rollback probe') throw error;
      }
      return Response.json(db.select({ name: schema.machine.name }).from(schema.machine).all());
    }
    if (input.operation === 'nested') {
      db.transaction((outer) => {
        outer
          .update(schema.machine)
          .set({ name: 'outer' })
          .where(eq(schema.machine.id, 'alpha'))
          .run();
        try {
          outer.transaction((inner) => {
            inner
              .update(schema.machine)
              .set({ name: 'inner' })
              .where(eq(schema.machine.id, 'beta'))
              .run();
            throw new Error('inner probe');
          });
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'inner probe') throw error;
        }
        outer
          .update(schema.machine)
          .set({ name: 'after catch' })
          .where(eq(schema.machine.id, 'alpha'))
          .run();
      });
      return Response.json(
        db
          .select({ id: schema.machine.id, name: schema.machine.name })
          .from(schema.machine)
          .orderBy(schema.machine.id)
          .all(),
      );
    }
    if (input.operation === 'metadata') {
      const result = db
        .update(schema.machine)
        .set({ lastSeenAt: 55 })
        .where(eq(schema.machine.id, 'alpha'))
        .run();
      return Response.json({
        resultType: typeof result,
        row: db
          .select({ lastSeenAt: schema.machine.lastSeenAt })
          .from(schema.machine)
          .where(eq(schema.machine.id, 'alpha'))
          .get(),
      });
    }
    return new Response(null, { status: 404 });
  }
}

export default {
  fetch(request: Request, env: Environment) {
    return env.DATABASE.getByName(request.headers.get('x-test-database') ?? 'default').fetch(
      request,
    );
  },
};
