import type { PrPanelRow } from '@cairn/shared';
import { type PrCardModel, type PrCardState, shortHead } from './pr-card-model.js';

export const PR_READ_LATE_MS = 10 * 60_000;

const MERGEABLE_STATES: ReadonlySet<PrPanelRow['mergeState']> = new Set(['clean', 'unstable']);

function stateOfRow(row: PrPanelRow): PrCardState {
  if (row.state === 'merged') return 'merged';
  if (row.state === 'closed') return 'closed';
  if (row.state === 'draft') return 'draft';
  if (row.mergeState === 'dirty') return 'conflicts';
  if (row.checks.failed > 0) return 'checks-failed';
  if (row.checks.running > 0) return 'checks-running';
  if (row.verdict?.result === 'block') return 'review-block';
  if (row.verdict === null) return 'review-pending';
  if (row.verdict.judgedHead !== row.head) return 'review-pending';
  if (MERGEABLE_STATES.has(row.mergeState)) return 'review-pass';
  return row.mergeState === 'behind' ? 'behind' : 'merge-blocked';
}

export function prCardModelOfRow(row: PrPanelRow, now: number): PrCardModel {
  const state = stateOfRow(row);
  const finished = state === 'merged' || state === 'closed';
  const lateMs = now - row.updatedAt;
  return {
    number: row.number,
    title: row.title,
    repo: row.repo,
    state,
    checks: row.checks,
    verdict:
      row.verdict === null
        ? null
        : { result: row.verdict.result, judgedHead: shortHead(row.verdict.judgedHead) },
    currentHead: shortHead(row.head),
    ...(!finished && lateMs > PR_READ_LATE_MS
      ? { readAgoMinutes: Math.floor(lateMs / 60_000) }
      : {}),
  };
}

export function prByThread(rows: readonly PrPanelRow[] | undefined): Map<string, PrPanelRow> {
  const byThread = new Map<string, PrPanelRow>();
  for (const row of rows ?? []) if (!byThread.has(row.threadId)) byThread.set(row.threadId, row);
  return byThread;
}

export function prChecksText(checks: PrPanelRow['checks']): string | null {
  return checks.total > 0 ? `${checks.passed}/${checks.total}` : null;
}
