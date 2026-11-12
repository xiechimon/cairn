import { homedir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { openDbWithHandle } from '../../../apps/server/src/db/client.js';
import { coordinatorTurnSnapshot } from '../../../apps/server/src/db/schema.js';
import { harvestSnapshotReplayInput } from './snapshot.mts';

export interface HarvestCandidate {
  turnId: string;
  teamId: string;
  sourceTraceId: string;
  eligible: boolean;
  reason: string | null;
}

export function listHarvestCandidates(
  db: Parameters<typeof harvestSnapshotReplayInput>[0],
  teamId: string,
): HarvestCandidate[] {
  const rows = db
    .select()
    .from(coordinatorTurnSnapshot)
    .where(eq(coordinatorTurnSnapshot.teamId, teamId))
    .all();
  return rows.map((row) => {
    try {
      harvestSnapshotReplayInput(db, teamId, row.turnId);
      return {
        turnId: row.turnId,
        teamId,
        sourceTraceId: row.sourceTraceId,
        eligible: true,
        reason: null,
      };
    } catch (error) {
      return {
        turnId: row.turnId,
        teamId,
        sourceTraceId: row.sourceTraceId,
        eligible: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export function buildDatasetItem(
  input: Parameters<typeof harvestSnapshotReplayInput>[0],
  teamId: string,
  turnId: string,
  expectedOutput: unknown,
  datasetName: string,
) {
  const replay = harvestSnapshotReplayInput(input, teamId, turnId);
  return {
    datasetName,
    input: replay,
    expectedOutput,
    sourceTraceId: replay.snapshot.sourceTraceId,
    id: `cairn-routing-${turnId}`,
  };
}

if (process.argv[1] && import.meta.filename.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const [dbPath, teamId, ...turnIds] = process.argv.slice(2);
  if (!dbPath || !teamId) {
    console.error('usage: harvest.mts <db-path|-> <team-id> [--dataset <name>] [turn-id...]');
    process.exitCode = 2;
  } else {
    const datasetName = process.argv.includes('--dataset')
      ? (process.argv[process.argv.indexOf('--dataset') + 1] ?? 'routing')
      : 'routing';
    const opened =
      dbPath === '-'
        ? openDbWithHandle(join(homedir(), '.cairn/server/server.db'))
        : openDbWithHandle(dbPath);
    try {
      if (turnIds.length === 0) {
        for (const candidate of listHarvestCandidates(opened.db, teamId)) {
          console.log(
            JSON.stringify({
              ...candidate,
              ...(candidate.eligible ? { datasetName } : {}),
            }),
          );
        }
      } else {
        for (const turnId of turnIds) {
          console.log(
            JSON.stringify(buildDatasetItem(opened.db, teamId, turnId, null, datasetName)),
          );
        }
      }
    } finally {
      opened.close();
    }
  }
}
