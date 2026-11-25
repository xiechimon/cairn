import { eq } from 'drizzle-orm';
import { registerDatabaseIdentity } from '../db/identity.js';
import { machine, step } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { MachineDeps } from './machine-deps.js';

export interface MachineClaimScope {
  machineId: string;
  stepId: string;
  generation?: number;
  tokenHash?: string | null;
}

export function claimGenerationAccepted(
  db: MachineDeps['db'],
  machineId: string | null,
  claimedAt: number | null,
  generation: number | undefined,
): boolean {
  if (generation !== undefined) return claimedAt === generation;
  if (machineId === null) return false;
  const runner = db
    .select({ capabilities: machine.capabilities })
    .from(machine)
    .where(eq(machine.id, machineId))
    .get();
  return runner !== undefined && runner.capabilities?.claimGeneration !== true;
}

export function assertMachineClaim(deps: Pick<MachineDeps, 'db'>, claim: MachineClaimScope): void {
  const row = deps.db.select().from(step).where(eq(step.id, claim.stepId)).get();
  if (!row) throw new HttpError(404, `step ${claim.stepId} no longer exists`);
  if (row.machineId !== claim.machineId)
    throw new HttpError(404, `step ${claim.stepId} (not yours)`);
  if (row.status !== 'claimed') throw new HttpError(409, `step ${claim.stepId} is not claimed`);
  if (claim.tokenHash !== undefined) {
    const runner = deps.db.select().from(machine).where(eq(machine.id, claim.machineId)).get();
    if (runner?.tokenHash !== claim.tokenHash || runner.retiredAt !== null)
      throw new HttpError(401, 'unauthorized');
  }
  if (!claimGenerationAccepted(deps.db, claim.machineId, row.claimedAt, claim.generation))
    throw new HttpError(409, `step ${claim.stepId} requires its current claim generation`);
}

export function scopeMachineClaim(deps: MachineDeps, claim: MachineClaimScope): MachineDeps {
  const assertClaim = () => assertMachineClaim(deps, claim);
  assertClaim();
  const write = <T>(run: () => T): T =>
    deps.db.transaction(
      () => {
        assertClaim();
        return run();
      },
      { behavior: 'immediate' },
    );
  const builder = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(object, key) {
        const member: unknown = Reflect.get(object, key, object);
        if (typeof member !== 'function') return member;
        return (...args: unknown[]) => {
          const invoke = () => Reflect.apply(member, object, args) as unknown;
          if (['run', 'all', 'get', 'execute', 'then'].includes(String(key))) return write(invoke);
          const result = invoke();
          return result !== null && typeof result === 'object' ? builder(result) : result;
        };
      },
    });
  const db = new Proxy(deps.db, {
    get(object, key) {
      const member: unknown = Reflect.get(object, key, object);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]) => {
        if (['insert', 'update', 'delete'].includes(String(key))) {
          assertClaim();
          return builder(Reflect.apply(member, object, args) as object);
        }
        if (['run', 'transaction'].includes(String(key)))
          return write(() => Reflect.apply(member, object, args));
        return Reflect.apply(member, object, args) as unknown;
      };
    },
  });
  registerDatabaseIdentity(db, deps.db);
  const signals = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(object, key) {
        const member: unknown = Reflect.get(object, key, object);
        if (typeof member !== 'function') return member;
        return (...args: unknown[]) => {
          assertClaim();
          return Reflect.apply(member, object, args) as unknown;
        };
      },
    });
  const githubBaseFetch = deps.githubBaseFetch;
  const oauthFetch = deps.oauthFetch;
  return {
    ...deps,
    db,
    assertClaim,
    githubFetch: (...args) => {
      assertClaim();
      return (deps.githubFetch ?? fetch)(...args);
    },
    ...(githubBaseFetch !== undefined
      ? {
          githubBaseFetch: (...args: Parameters<NonNullable<MachineDeps['githubBaseFetch']>>) => {
            assertClaim();
            return githubBaseFetch(...args);
          },
        }
      : {}),
    ...(oauthFetch !== undefined
      ? {
          oauthFetch: (...args: Parameters<NonNullable<MachineDeps['oauthFetch']>>) => {
            assertClaim();
            return oauthFetch(...args);
          },
        }
      : {}),
    hub: signals(deps.hub),
    machineHub: signals(deps.machineHub),
    ...(deps.convHub !== undefined ? { convHub: signals(deps.convHub) } : {}),
  };
}
