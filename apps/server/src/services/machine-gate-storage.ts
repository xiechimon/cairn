import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type MergeGateRun, mergeGateRunSchema, redactSecrets } from '@cairn/shared';

export function readGateRuns(attachmentsDir: string, buildId: string): MergeGateRun[] {
  const path = join(attachmentsDir, 'gate-runs', `${encodeURIComponent(buildId)}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => mergeGateRunSchema.parse(JSON.parse(line)));
}

export function appendGateRun(attachmentsDir: string, run: MergeGateRun): void {
  const dir = join(attachmentsDir, 'gate-runs');
  mkdirSync(dir, { recursive: true });
  const clean = mergeGateRunSchema.parse(redactSecrets(run).value);
  appendFileSync(
    join(dir, `${encodeURIComponent(run.buildId)}.jsonl`),
    `${JSON.stringify(clean)}\n`,
    { mode: 0o600 },
  );
}

export function readGateSession(attachmentsDir: string, stepId: string): string | null {
  const path = join(attachmentsDir, 'step-sessions', `${encodeURIComponent(stepId)}.jsonl`);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
