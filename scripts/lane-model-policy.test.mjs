import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BANNED_MODEL_IDS,
  bannedModelFromLog,
  isBannedModelId,
  parseAiRouteSelection,
  parseModelRoles,
} from './lane-model-policy.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

test('deepseek-v4-flash from issue #2021 is banned; deepseek-v4.1-flash is not', () => {
  assert.equal(isBannedModelId('deepseek-v4-flash'), true);
  assert.equal(isBannedModelId('DeepSeek-V4-Flash'), true);
  assert.equal(isBannedModelId('deepseek-v4.1-flash'), false);
  assert.equal(isBannedModelId('deepseek-v4.1-flash[1M]'), false);
});

test('parseAiRouteSelection reads the #2021 implement route line', () => {
  const line = 'ai-route: implement -> pi:domestic-proxy/deepseek-v4-flash';
  assert.deepEqual(parseAiRouteSelection(line), {
    task: 'implement',
    route: 'pi:domestic-proxy/deepseek-v4-flash',
    modelId: 'deepseek-v4-flash',
  });
});

test('bannedModelFromLog reds the real #1517/#1792 exit artifact', () => {
  const log = [
    'other noise',
    'ai-route: implement -> pi:domestic-proxy/deepseek-v4-flash',
    '',
  ].join('\n');
  const hit = bannedModelFromLog(log);
  assert.ok(hit);
  assert.equal(hit.modelId, 'deepseek-v4-flash');
  assert.equal(hit.task, 'implement');
});

test('bannedModelFromLog stays quiet for the allowed deepseek-v4.1-flash route', () => {
  const log = 'ai-route: implement -> pi:domestic-proxy/deepseek-v4.1-flash\n';
  assert.equal(bannedModelFromLog(log), null);
});

test('AGENTS.md Do-not-use models are covered by BANNED_MODEL_IDS', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  const banLine = agents
    .split('\n')
    .find((line) => line.startsWith('- **Do not use**:'))
    ?.slice('- **Do not use**:'.length);
  assert.ok(banLine, 'AGENTS.md must keep a Do not use line');
  assert.match(banLine, /DeepSeek V4 Flash/i);
  assert.match(banLine, /MiniMax M3/i);
  assert.match(banLine, /gpt-6-astra/i);
  assert.match(banLine, /GPT 5\.6/i);
  assert.deepEqual(
    [...banLine.matchAll(/`([a-z][a-z0-9.]*(?:-[a-z0-9.*]+)+)`/gi)].map((match) => match[1]),
    [...BANNED_MODEL_IDS, 'gpt-5.6*'],
  );
  for (const id of ['deepseek-v4-flash', 'minimax-m3', 'gpt-6-astra']) {
    assert.ok(BANNED_MODEL_IDS.includes(id), `missing ${id}`);
  }
  assert.equal(isBannedModelId('gpt-5.6-sol'), true);
  assert.equal(isBannedModelId('gpt-5.6-luna'), true);
});

test('AGENTS.md Model roles table pins the role models and names no banned id', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  const rows = parseModelRoles(agents);
  assert.deepEqual(rows.find((row) => row.role === 'Orchestration')?.modelIds, ['claude-opus-5-5']);
  assert.deepEqual(rows.find((row) => row.role === 'Implementation')?.modelIds, [
    'gpt-6.1-sol',
    'claude-sonnet-5-5',
  ]);
  assert.deepEqual(rows.find((row) => row.role === 'Mechanical work')?.modelIds, [
    'claude-haiku-5-5',
  ]);
  assert.deepEqual(rows.find((row) => row.role === 'Review')?.modelIds, []);
  assert.deepEqual(
    rows.map((row) => row.role),
    ['Orchestration', 'Implementation', 'Mechanical work', 'Review'],
  );
  for (const row of rows) {
    for (const id of row.modelIds) {
      assert.equal(isBannedModelId(id), false, `${row.role} names banned model ${id}`);
    }
  }
});

test('parseModelRoles finds a banned id written without backticks', () => {
  const markdown =
    '## Model roles\n| Role | Model |\n|---|---|\n| Review | deepseek-v4-flash from a fresh context |';
  assert.deepEqual(parseModelRoles(markdown).find((row) => row.role === 'Review')?.modelIds, [
    'deepseek-v4-flash',
  ]);
});

test('parseModelRoles keeps a model id after an escaped pipe', () => {
  const markdown =
    '## Model roles\n| Role | Model |\n|---|---|\n| Implementation | `gpt-6.1-sol` \\| deepseek-v4-flash |';
  assert.deepEqual(
    parseModelRoles(markdown).find((row) => row.role === 'Implementation')?.modelIds,
    ['gpt-6.1-sol', 'deepseek-v4-flash'],
  );
});

test('parseModelRoles drops sentence punctuation after a model id', () => {
  const markdown = '## Model roles\n| Role | Model |\n|---|---|\n| Review | deepseek-v4-flash. |';
  assert.deepEqual(parseModelRoles(markdown).find((row) => row.role === 'Review')?.modelIds, [
    'deepseek-v4-flash',
  ]);
});

test('parseModelRoles retains banned ids and excludes tables under other headings', () => {
  const markdown = [
    '## Other models',
    '| Role | Model |',
    '|---|---|',
    '| Orchestration | `outside-before` |',
    '## Model roles',
    '| Role | Model |',
    '|---|---|',
    '| Implementation | `deepseek-v4-flash` |',
    '## More models',
    '| Role | Model |',
    '|---|---|',
    '| Mechanical work | `outside-after` |',
  ].join('\n');
  const rows = parseModelRoles(markdown);
  assert.deepEqual(rows, [
    {
      role: 'Implementation',
      model: '`deepseek-v4-flash`',
      modelIds: ['deepseek-v4-flash'],
    },
  ]);
  assert.equal(isBannedModelId(rows[0].modelIds[0]), true);
});

test('parseModelRoles returns no rows when the heading is missing', () => {
  assert.deepEqual(
    parseModelRoles('## Other models\n| Role | Model |\n|---|---|\n| Review | `gpt-6.1-sol` |'),
    [],
  );
});
