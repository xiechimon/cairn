import type { Context } from '@earendil-works/chord/context';
import type { Harness } from '@earendil-works/pi-durable';

export interface StaleRunsResult {
  adopted: string[];
  aborted: string[];
  placedStale: boolean;
}

export async function settleStaleSubmissions(
  harness: Harness,
  context: Context,
  isLive: (requestId: string) => boolean,
): Promise<StaleRunsResult> {
  const result: StaleRunsResult = { adopted: [], aborted: [], placedStale: false };
  const { submissions } = await harness.inspect(context);
  for (const record of submissions) {
    if (record.type !== 'input') continue;
    if (record.requestId !== undefined && isLive(record.requestId)) {
      result.adopted.push(record.requestId);
      continue;
    }
    const submission = await harness.submission(record.id, context);
    const outcome = await submission?.abort(context);
    result.aborted.push(record.requestId ?? String(record.id));
    if (outcome === 'already_placed') result.placedStale = true;
  }
  return result;
}
