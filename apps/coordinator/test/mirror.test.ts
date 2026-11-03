import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it } from 'vitest';
import { openCoordinatorHarness } from '../src/runtime/harness.js';
import { createCoordinatorModels } from '../src/runtime/models.js';
import { coordinatorToolsExtension, createStepGate } from '../src/runtime/tools.js';
import { runCoordinatorTurn } from '../src/runtime/turn.js';
import { chiefStep, fakeMachineApi } from './fake-machine-api.js';

const ctx = BACKGROUND_CONTEXT;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type FauxContext = { messages: { role: string }[] };

async function runToolTurn(tokensPerSecond: number) {
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond,
  });
  faux.setResponses(
    Array(4).fill((c: FauxContext) =>
      c.messages.at(-1)?.role === 'toolResult'
        ? fauxAssistantMessage(`two todos are open ${'and more '.repeat(40)}`.trim())
        : fauxAssistantMessage(
            [
              { type: 'text', text: 'checking' },
              fauxToolCall('todos', { projectId: 'p1' }, { id: 'call-1' }),
            ],
            { stopReason: 'toolUse' },
          ),
    ),
  );
  const coordinatorModels = createCoordinatorModels([faux.provider]);
  const dir = mkdtempSync(join(tmpdir(), 'coord-mirror-'));
  dirs.push(dir);
  const api = fakeMachineApi();
  const gate = createStepGate();
  const harness = await openCoordinatorHarness(
    join(dir, 'c.sqlite'),
    coordinatorModels.models,
    ctx,
    {
      extensions: [coordinatorToolsExtension(api, gate)],
    },
  );
  await runCoordinatorTurn(
    {
      harness,
      models: coordinatorModels,
      api,
      context: ctx,
      heartbeatMs: 10_000,
      now: () => 1,
      gate,
    },
    chiefStep('step-m', 'what is open?'),
  );
  await harness.close(ctx);
  return api;
}

describe('mirror into chief_message', () => {
  it('writes the text, the tool call with its result and the answer as Coordinator rows', async () => {
    const api = await runToolTurn(1e9);
    const latest = new Map(api.rows.map((r) => [r.row.id, r.row]));
    const rows = [...latest.values()];
    const toolRow = latest.get('call-1');
    expect(toolRow?.content).toMatchObject({
      kind: 'toolcall',
      call: {
        id: 'call-1',
        name: 'todos',
        arguments: { projectId: 'p1' },
        result: [{ type: 'text', text: 'result of todos' }],
        isError: false,
      },
    });
    const texts = rows.flatMap((r) =>
      Array.isArray(r.content) ? r.content.map((b) => (b as { text: string }).text) : [],
    );
    expect(texts[0]).toBe('checking');
    expect(texts.at(-1)).toMatch(/^two todos are open/);
    for (const row of rows) expect(row.role).toBe('assistant');
    expect(api.rows.every((r) => r.stepId === 'step-m')).toBe(true);
  });

  it('posts each row once per content change', async () => {
    const api = await runToolTurn(1e9);
    const seen = api.rows.map((r) => `${r.row.id}:${JSON.stringify(r.row.content)}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('streams the answer as it is written', async () => {
    const api = await runToolTurn(300);
    expect(api.deltas.length).toBeGreaterThan(1);
    expect(api.deltas.map((d) => d.text).join('')).toContain('two todos are open');
  });
});
