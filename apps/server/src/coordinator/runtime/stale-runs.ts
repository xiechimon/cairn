import type { Context } from '@earendil-works/chord/context';
import type { ConversationId, Harness, SubmissionRecord } from '@earendil-works/pi-durable';

export interface StaleRunsResult {
  adopted: string[];
  aborted: string[];
  orphaned: ConversationId[];
}

export async function settleStaleSubmissions(
  harness: Harness,
  context: Context,
  adopt: (record: SubmissionRecord) => boolean,
): Promise<StaleRunsResult> {
  const result: StaleRunsResult = { adopted: [], aborted: [], orphaned: [] };
  const placed = new Set<ConversationId>();
  const kept = new Set<ConversationId>();
  const { submissions } = await harness.inspect(context);
  for (const record of submissions) {
    if (record.type !== 'input') continue;
    if (adopt(record)) {
      result.adopted.push(record.requestId ?? String(record.id));
      kept.add(record.conversationId);
      continue;
    }
    const submission = await harness.submission(record.id, context);
    const outcome = await submission?.abort(context);
    result.aborted.push(record.requestId ?? String(record.id));
    if (outcome === 'already_placed') placed.add(record.conversationId);
  }
  result.orphaned = [...placed].filter((id) => !kept.has(id));
  return result;
}
