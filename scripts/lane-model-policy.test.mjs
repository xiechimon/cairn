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
  const log = ['other noise', 'ai-route: implement -> pi:domestic-proxy/deepseek-v4-flash', ''].join(
    '\n',
  );
  const hit = bannedModelFromLog(log);
  assert.ok(hit);
  assert.equal(hit.modelId, 'deepseek-v4-flash');
  assert.equal(hit.task, 'implement');
});

test('bannedModelFromLog stays quiet for the allowed deepseek-v4.1-flash route', () => {
  const log = 'ai-route: implement -> pi:domestic-proxy/deepseek-v4.1-flash\n';
  assert.equal(bannedModelFromLog(log), null);
});

test('workflow.md Do-not-use models are covered by BANNED_MODEL_IDS', () => {
  const workflow = readFileSync(join(ROOT, '.claude/workflow.md'), 'utf8');
  const banLine = workflow
    .split('\n')
    .find((line) => line.startsWith('- Do not use:'))
    ?.slice('- Do not use:'.length);
  assert.ok(banLine, 'workflow.md must keep a Do not use line');
  assert.match(banLine, /DeepSeek V4 Flash/i);
  assert.match(banLine, /MiniMax M3/i);
  assert.match(banLine, /gpt-6-astra/i);
  assert.match(banLine, /GPT 5\.6/i);
  for (const id of ['deepseek-v4-flash', 'minimax-m3', 'gpt-6-astra']) {
    assert.ok(BANNED_MODEL_IDS.includes(id), `missing ${id}`);
  }
  assert.equal(isBannedModelId('gpt-5.6-sol'), true);
  assert.equal(isBannedModelId('gpt-5.6-luna'), true);
});
