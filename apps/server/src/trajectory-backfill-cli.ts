import { loadConfig, reposDirOf } from './config.js';
import { openDbWithHandle } from './db/client.js';
import { sweepOutcomeBackfill } from './trajectory-outcome-backfill.js';

try {
  const config = loadConfig();
  const opened = openDbWithHandle(config.dbPath);
  try {
    const summary = await sweepOutcomeBackfill(
      {
        db: opened.db,
        reposDir: reposDirOf(config),
        logger: { info: (obj, msg) => console.log(msg, obj) },
      },
      Date.now(),
    );
    console.log(
      `scanned=${summary.scanned} window_open=${summary.windowOpen} backfilled=${summary.backfilled} skipped_no_repo=${summary.skippedNoRepo} skipped_no_merge=${summary.skippedNoMerge} failed=${summary.failed}`,
    );
  } finally {
    opened.close();
  }
} catch (error) {
  console.error(
    `Trajectory outcome backfill failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
