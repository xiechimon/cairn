import type { TopModel } from '@cairn/shared';
import { QueryClient } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { saveFrequentModels } from '../src/api/frequent-models.js';

vi.mock('../src/api/client.js', () => ({ api: { put: vi.fn(), get: vi.fn() } }));

const A: TopModel = { provider: 'devin', modelId: 'swe-2-1-medium', thinkingLevel: null };
const B: TopModel = { provider: 'doubao', modelId: 'auto', thinkingLevel: null };

test('two quick Settings saves run one after another with the version the previous one returned', async () => {
  let version = 1;
  let models: TopModel[] = [];
  const versions: (number | null)[] = [];
  vi.mocked(api.put).mockImplementation((async (_path: string, body: unknown) => {
    const next = body as { models: TopModel[]; updatedAt: number | null };
    versions.push(next.updatedAt);
    if (next.updatedAt !== version) throw new Error('409 stale');
    models = next.models;
    version += 1;
    return { models, updatedAt: version };
  }) as typeof api.put);
  const client = new QueryClient();
  const key = ['frequent-models', 'team-quick-saves'];
  client.setQueryData(key, { models, updatedAt: version });

  const first = saveFrequentModels(client, key, 'team-quick-saves', [A]);
  const second = saveFrequentModels(client, key, 'team-quick-saves', [A, B]);
  await Promise.all([first, second]);

  expect(models).toEqual([A, B]);
  expect(versions).toEqual([1, 2]);
});
