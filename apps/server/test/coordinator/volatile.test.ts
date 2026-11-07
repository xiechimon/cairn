import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { UserEntry } from '@earendil-works/pi-durable';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { createConversationGate } from '../../src/coordinator/runtime/tools.js';
import { runCoordinatorTurn } from '../../src/coordinator/runtime/turn.js';
import {
  createVolatileContext,
  volatileContextExtension,
  withVolatileSection,
} from '../../src/coordinator/runtime/volatile.js';
import { chiefStep, fakeMachineApi } from './fake-machine-api.js';

const ctx = BACKGROUND_CONTEXT;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) releaseTestTempDir(d);
});

describe('volatile turn context', () => {
  it('reaches only the request of its own turn and is never stored', async () => {
    const dir = makeTestTempDir('coord-volatile-');
    dirs.push(dir);
    const requests: string[] = [];
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 200_000 }],
      tokensPerSecond: 1e9,
    });
    faux.setResponses(
      Array(4).fill((c: { messages: unknown[] }) => {
        requests.push(JSON.stringify(c.messages));
        return fauxAssistantMessage('ok');
      }),
    );
    const models = createCoordinatorModels([faux.provider]);
    const volatile = createVolatileContext();
    const harness = await openCoordinatorHarness(join(dir, 's.sqlite'), models.models, ctx, {
      extensions: [volatileContextExtension(volatile)],
    });
    const api = fakeMachineApi();
    const deps = {
      harness,
      models,
      api,
      context: ctx,
      heartbeatMs: 1000,
      now: () => 1,
      conversationGate: createConversationGate(),
      volatile,
    };

    await runCoordinatorTurn(
      { ...deps, volatileText: 'PROJECT-A-SECTION' },
      chiefStep('s1', 'first prompt'),
    );
    await runCoordinatorTurn(
      { ...deps, volatileText: 'PROJECT-B-SECTION' },
      chiefStep('s2', 'second prompt'),
    );

    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain('PROJECT-A-SECTION');
    expect(requests[1]).toContain('PROJECT-B-SECTION');
    expect(requests[1]).not.toContain('PROJECT-A-SECTION');
    const root = await harness.root(ctx);
    const stored = (await root.entries({}, 50, undefined, ctx)).items
      .filter((entry) => UserEntry.is(entry))
      .map((entry) => JSON.stringify(entry.model));
    expect(stored).toHaveLength(2);
    expect(stored.join('')).not.toContain('SECTION');
    expect(stored.join('')).toContain('first prompt');
    expect(stored.join('')).toContain('second prompt');
    await harness.close(ctx);
  });

  it('appends to the last user message in string and block form', () => {
    const base = { timestamp: 1 };
    const text = withVolatileSection(
      [
        { role: 'user', content: 'a', ...base },
        { role: 'user', content: 'b', ...base },
      ],
      'S',
    );
    expect(text[0]?.role === 'user' && text[0].content).toBe('a');
    expect(text[1]?.role === 'user' && text[1].content).toBe('b\n\nS');
    const blocks = withVolatileSection(
      [{ role: 'user', content: [{ type: 'text', text: 'x' }], ...base }],
      'S',
    );
    expect(JSON.stringify(blocks)).toContain('"text":"\\n\\nS"');
  });
});
