import { createHash } from 'node:crypto';
import {
  EVIDENCE_PREFIX,
  HARNESS_REGRESSION_RESULT_NAME,
  type HarnessRegressionResult,
  harnessRegressionResultSchema,
} from '@cairn/shared';

export function harnessEvalResultRelPath(ticketRef: string): string {
  return `${EVIDENCE_PREFIX}${ticketRef}/${HARNESS_REGRESSION_RESULT_NAME}`;
}

export function decisionOkRate(
  rows: readonly { grade?: { decision_ok?: number } }[],
): number | null {
  if (rows.length === 0) return null;
  let ok = 0;
  for (const row of rows) {
    if (row.grade?.decision_ok === 1) ok += 1;
  }
  return ok / rows.length;
}

export function parseResultsJsonl(text: string): { grade?: { decision_ok?: number } }[] {
  const rows: { grade?: { decision_ok?: number } }[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as { grade?: { decision_ok?: number } });
  }
  return rows;
}

export function traceDigest(files: readonly { name: string; body: Uint8Array }[]): string {
  const h = createHash('sha256');
  const ordered = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const f of ordered) {
    h.update(f.name).update('\0').update(f.body).update('\0');
  }
  return h.digest('hex');
}

export function buildHarnessEvalResult(input: {
  patchDigest: string;
  harness_sha: string;
  decision_ok: number;
  trace_digest: string;
}): HarnessRegressionResult {
  return harnessRegressionResultSchema.parse(input);
}
