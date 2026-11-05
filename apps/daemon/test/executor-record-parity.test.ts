import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildExecutorRecord } from '../src/executor-record.js';
import type { HarnessMaterial } from '../src/harness-hash.js';

interface Vector {
  name: string;
  input: HarnessMaterial & { backend: string; model: string; effort: string | null };
  record: { backend: string; model: string; harness_sha: string; effort: string | null };
}

const vectors: Vector[] = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../integration/eval/harbor/public/parity-vectors.json'),
    'utf8',
  ),
).vectors;

describe('executor record parity with the Harbor eval executor', () => {
  test('the shared vectors are present', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(3);
  });

  test.each(vectors)('$name builds the record the eval side records', ({ input, record }) => {
    expect(
      buildExecutorRecord({
        backend: input.backend,
        model: input.model,
        effort: input.effort,
        harness: {
          systemPrompt: input.systemPrompt,
          skills: input.skills,
          tools: input.tools,
        },
      }),
    ).toEqual(record);
  });

  test('records the same four fields and nothing else', () => {
    const record = buildExecutorRecord({
      backend: 'pi',
      model: 'p/m',
      harness: { systemPrompt: '', skills: [], tools: [] },
    });
    expect(Object.keys(record).sort()).toEqual(['backend', 'effort', 'harness_sha', 'model']);
  });

  test.each([undefined, null, ''])('an unset effort %j is recorded as null', (effort) => {
    expect(
      buildExecutorRecord({
        backend: 'pi',
        model: 'p/m',
        effort,
        harness: { systemPrompt: '', skills: [], tools: [] },
      }).effort,
    ).toBeNull();
  });
});
