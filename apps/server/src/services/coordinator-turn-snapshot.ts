import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

export const COORDINATOR_SNAPSHOT_RETENTION_MS = 30 * 86_400_000;
export const COORDINATOR_SNAPSHOT_CLEANUP_INTERVAL_MS = 86_400_000;
export const COORDINATOR_SNAPSHOT_TEAM_BYTES = 256 * 1024 * 1024;
export const COORDINATOR_SNAPSHOT_CLEANUP_BATCH = 1000;

export function sweepCoordinatorTurnSnapshots(db: Db, now: number): number {
  return db.run(sql`
    WITH retained AS (
      SELECT turnId, capturedAt,
        sum(payloadBytes) OVER (
          PARTITION BY teamId ORDER BY capturedAt DESC, turnId DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS retainedBytes
      FROM coordinator_turn_snapshot WHERE expiresAt > ${now} AND status = 'sealed'
    ), victims AS (
      SELECT turnId, capturedAt FROM coordinator_turn_snapshot WHERE expiresAt <= ${now}
      UNION ALL
      SELECT turnId, capturedAt FROM retained WHERE retainedBytes > ${COORDINATOR_SNAPSHOT_TEAM_BYTES}
      ORDER BY capturedAt, turnId LIMIT ${COORDINATOR_SNAPSHOT_CLEANUP_BATCH}
    )
    DELETE FROM coordinator_turn_snapshot WHERE turnId IN (SELECT turnId FROM victims)
  `).changes;
}
