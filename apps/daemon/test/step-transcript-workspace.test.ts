import { describe, expect, test, vi } from 'vitest';
import { StepTranscriptStream } from '../src/step-transcript-stream.js';

const INSTANCE = 'A'.repeat(48);

function stream(workspace?: string | null) {
  const transcriptRow = vi.fn(async () => {});
  const upserts: unknown[] = [];
  const instance = new StepTranscriptStream({
    stepId: 's1',
    client: {
      transcriptRow,
      transcriptDelta: async () => {},
    } as never,
    transcript: { upsert: (row) => upserts.push(row) },
    agentTodo: { report: () => {} },
    now: () => 1_000,
    log: () => {},
    ...(workspace !== undefined ? { workspace } : {}),
  });
  return { instance, transcriptRow, upserts };
}

describe('worker transcript workspace binding', () => {
  test('every assistant text row of the step carries the one prepared-workspace instance', async () => {
    const { instance, transcriptRow, upserts } = stream(INSTANCE);
    await instance.segments.append('text', 'Saved report.md');
    await instance.segments.seal();
    await instance.segments.append('text', 'And notes.md');
    await instance.segments.seal();
    expect(transcriptRow).toHaveBeenCalledTimes(2);
    expect(transcriptRow.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
      INSTANCE,
      INSTANCE,
    ]);
    expect(JSON.stringify(upserts)).not.toContain(INSTANCE);
  });

  test('thinking rows and unbound steps stay as before', async () => {
    const bound = stream(INSTANCE);
    await bound.instance.segments.append('thinking', 'hmm');
    await bound.instance.segments.seal();
    expect(bound.transcriptRow.mock.calls[0]).toHaveLength(2);

    const unbound = stream();
    await unbound.instance.segments.append('text', 'Saved report.md');
    await unbound.instance.segments.seal();
    expect(unbound.transcriptRow.mock.calls[0]).toHaveLength(2);

    const refused = stream(null);
    await refused.instance.segments.append('text', 'Saved report.md');
    await refused.instance.segments.seal();
    expect(refused.transcriptRow.mock.calls[0]).toHaveLength(2);
  });
});
