import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { gateState, gateVerdict } from '../db/schema.js';

export function buildVerified(db: Db, buildId: string): boolean {
  const latest = db
    .select({
      outcome: gateVerdict.outcome,
      headSha: gateVerdict.headSha,
      patchDigest: gateVerdict.patchDigest,
    })
    .from(gateVerdict)
    .where(and(eq(gateVerdict.buildId, buildId), eq(gateVerdict.kind, 'verify')))
    .orderBy(desc(gateVerdict.createdAt))
    .limit(1)
    .get();
  if (latest?.outcome !== 'pass') return false;
  const judged = db
    .select({ headSha: gateState.headSha, patchDigest: gateState.patchDigest })
    .from(gateState)
    .where(eq(gateState.buildId, buildId))
    .get();
  if (judged === undefined || judged.headSha === null) return true;
  if (judged.headSha === latest.headSha) return true;
  return judged.patchDigest !== null && judged.patchDigest === latest.patchDigest;
}
