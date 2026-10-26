import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { redactSecrets } from '@cairn/shared';
import { ZodError } from 'zod';
import { loadConfig } from './config.js';
import { openDbWithHandle } from './db/client.js';
import { argvEqualsForm } from './lib/argv-equals-form.js';
import {
  CurateError,
  confirmCandidate,
  curateCandidates,
  dismissCandidate,
} from './trajectory-curate.js';

const USAGE =
  'Use --in <candidates.jsonl>, --confirm <candidateId> [--force] or --dismiss <candidateId>, with optional --out-dir <dir>';

try {
  const { values } = parseArgs({
    options: {
      in: { type: 'string' },
      confirm: { type: 'string' },
      dismiss: { type: 'string' },
      force: { type: 'boolean', default: false },
      'out-dir': { type: 'string' },
    },
    args: argvEqualsForm(process.argv.slice(2), ['in', 'confirm', 'dismiss', 'out-dir']),
  });
  const modes = [values.in, values.confirm, values.dismiss].filter((v) => v !== undefined);
  if (modes.length !== 1 || modes[0] === '') throw new CurateError(USAGE);
  const config = loadConfig();
  const outDir = resolve(values['out-dir'] ?? join(config.dataDir, 'experience-candidates'));
  const opened = openDbWithHandle(config.dbPath);
  try {
    if (values.confirm !== undefined) {
      const memoryId = confirmCandidate(opened.db, values.confirm, values.force);
      console.log(`promoted=${values.confirm} memory=${memoryId}`);
    } else if (values.dismiss !== undefined) {
      dismissCandidate(opened.db, values.dismiss);
      console.log(`dismissed=${values.dismiss}`);
    } else {
      const lines = readFileSync(values.in as string, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '');
      const s = curateCandidates(opened.db, lines, { skillsDir: config.skillsDir, outDir });
      console.log(
        [
          `memory_pending=${s.memoryPending} memory_merged=${s.memoryMerged} memory_known=${s.memoryKnown} memory_promoted=${s.memoryPromoted}`,
          `guard_new=${s.guardNew} guard_merged=${s.guardMerged}`,
          `skill_new=${s.skillNew} skill_merged=${s.skillMerged}`,
          `rejected=${s.rejected} build_missing=${s.buildMissing}`,
          `out_dir=${redactSecrets(outDir).value}`,
        ].join(' '),
      );
    }
  } finally {
    opened.close();
  }
} catch (error) {
  const reason =
    error instanceof CurateError
      ? error.message
      : error instanceof ZodError
        ? `Schema validation failed at ${error.issues.map((issue) => issue.path.join('.')).join(', ')}`
        : error instanceof SyntaxError
          ? 'Invalid JSONL input'
          : 'Invalid arguments or database/input/output I/O failed';
  console.error(`Experience curation failed: ${reason}`);
  process.exitCode = 1;
}
