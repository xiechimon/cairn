import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { afterEach, describe, expect, it } from 'vitest';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { seedCoordinator } from '../../src/coordinator/runtime/seed.js';
import {
  createThreadHarnesses,
  threadStorePath,
} from '../../src/coordinator/runtime/thread-harnesses.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('threadStorePath', () => {
  it('names one store per thread under the directory', () => {
    expect(threadStorePath('/s', 'chief-a1')).toBe('/s/chief-a1.sqlite');
  });

  it('refuses ids that could leave the directory', () => {
    for (const id of ['', '../x', 'a/b', 'a.b', '..']) {
      expect(() => threadStorePath('/s', id)).toThrow(/thread id/);
    }
  });
});

describe('createThreadHarnesses', () => {
  it('keeps each Coordinator thread in its own durable root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coord-threads-'));
    dirs.push(dir);
    const models = createCoordinatorModels();
    const ctx = BACKGROUND_CONTEXT;
    const harnesses = createThreadHarnesses(dir, models.models, ctx, {});
    const a = await harnesses.get('thread-a');
    const b = await harnesses.get('thread-b');
    expect(a).not.toBe(b);
    expect(await harnesses.get('thread-a')).toBe(a);
    await seedCoordinator(
      a,
      '',
      [{ id: 'm1', role: 'user', content: '"private to thread a"', createdAt: 1 }],
      { provider: 'stub', modelId: 'm' },
      ctx,
    );
    const inA = await (await a.root(ctx)).entries({}, 10, undefined, ctx);
    const inB = await (await b.root(ctx)).entries({}, 10, undefined, ctx);
    expect(inA.items).toHaveLength(1);
    expect(inB.items).toHaveLength(0);
    await harnesses.close();
  });
});
