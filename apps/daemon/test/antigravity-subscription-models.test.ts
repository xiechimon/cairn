import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { probeAntigravitySubscriptionModels } from '../src/backend/antigravity-subscription-models.js';

const TOKEN = 'fake-subscription-key';
const fixtures: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of fixtures.splice(0)) releaseTestTempDir(dir);
});

function fakeAgy(outcome: 'catalog' | 'groups' | 'empty' | 'auth') {
  const dir = makeTestTempDir('agy-subscription-models-');
  fixtures.push(dir);
  const script = join(dir, 'agy.mjs');
  const marker = join(dir, 'probe-home');
  writeFileSync(
    script,
    `import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
const home = process.env.HOME;
const send = (message) => console.log(JSON.stringify({ jsonrpc: '2.0', ...message }));
const reply = (id, result) => send({ id, result });
function settings(component) {
  return JSON.parse(readFileSync(join(home, '.gemini', component, 'settings.json'), 'utf8'));
}
function modelSelect(options) {
  return { id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'gemini-paid', options };
}
function update(sessionId, value, options = [{ value, name: value }]) {
  send({ method: 'session/update', params: { sessionId, update: {
    sessionUpdate: 'config_option_update', configOptions: [modelSelect(options)],
  } } });
}
if (
  process.env.GEMINI_API_KEY !== ${JSON.stringify(TOKEN)} ||
  process.env.GOOGLE_API_KEY !== undefined ||
  process.env.XDG_CONFIG_HOME !== join(home, '.config') ||
  process.env.GEMINI_HOME !== join(home, '.gemini') ||
  process.cwd() !== realpathSync(home) ||
  process.env.USERPROFILE !== home ||
  settings('antigravity-cli').modelProvider !== 'gemini' ||
  settings('antigravity-acp').auth.type !== 'gemini-api-key' ||
  existsSync(join(home, 'Library/Keychains')) ||
  existsSync(join(home, '.gemini/antigravity-acp/acp_token.json'))
) throw new Error('Model probe must use only its subscription key');
writeFileSync(${JSON.stringify(marker)}, home);
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') {
    reply(id, { protocolVersion: 1, agentCapabilities: {}, authMethods: [
      { id: 'oauth-personal', name: 'Personal' }, { id: 'gemini-api-key', name: 'Gemini key' },
    ] });
  } else if (method === 'session/new' && params.cwd === home && params.mcpServers.length === 0) {
    switch (${JSON.stringify(outcome)}) {
      case 'catalog':
        reply(id, { sessionId: 'live', configOptions: [modelSelect([
          { value: 'gemini-paid', name: 'Gemini Paid' },
          { group: 'external', name: 'External', options: [{ value: 'claude-paid', name: 'Claude Paid' }] },
        ])], models: { currentModelId: 'gemini-paid', availableModels: [
          { modelId: 'gemini-paid', name: 'Duplicate' },
          { modelId: 'gemini-paid-high', name: 'Gemini Paid High' },
          { modelId: 'independent-legacy-model', name: 'Independent Legacy Model' },
        ] } });
        update('foreign', 'foreign-model');
        setTimeout(() => update('live', 'gpt-from-update'), 25);
        break;
      case 'groups':
        reply(id, { sessionId: 'live', configOptions: [modelSelect([
          { value: 'late-grouped', name: 'Late Grouped' },
          { group: 'google', name: 'Gemini Models', options: [
            { value: 'gemini-grouped', name: 'Gemini Grouped' },
            { value: 'late-grouped', name: 'Ignored Duplicate' },
          ] },
          { group: 'external', name: 'Claude and GPT models', options: [
            { value: 'claude-grouped', name: 'C'.repeat(300) },
            { value: 'echoed-credential', name: 'C'.repeat(250) + ${JSON.stringify(TOKEN)} },
          ] },
          { group: 'leaky', name: 'Pool ' + ${JSON.stringify(TOKEN)}, options: [
            { value: 'leaky-group-model', name: 'Leaky Group Model' },
          ] },
          { group: 'long', name: 'G'.repeat(65), options: [
            { value: 'long-group-model', name: 'Long Group Model' },
          ] },
          { group: 'unnamed', name: '  ', options: [
            { value: 'unnamed-group-model', name: 'Unnamed Group Model' },
          ] },
        ])] });
        setTimeout(() => update('live', 'unused', [
          { group: 'late', name: 'Late Pool', options: [
            { value: 'late-update-model', name: 'Late Update Model' },
            { value: 'late-grouped', name: 'Ignored Duplicate' },
          ] },
        ]), 25);
        break;
      case 'empty':
        reply(id, { sessionId: 'live', configOptions: [] });
        break;
      case 'auth':
        send({ id, error: { code: -32000, message: '401 invalid API key' } });
        break;
    }
  } else {
    throw new Error('Unexpected ACP request');
  }
}
`,
  );
  return { install: { binPath: process.execPath, args: [script] }, marker, appData: dir };
}

test('uses only the supplied key in a scratch home and combines all three ACP model sources', async () => {
  vi.stubEnv('GEMINI_API_KEY', 'inherited-key');
  vi.stubEnv('GOOGLE_API_KEY', 'inherited-google-key');
  vi.stubEnv('XDG_CONFIG_HOME', '/inherited-config');
  const { install, marker, appData } = fakeAgy('catalog');
  expect(await probeAntigravitySubscriptionModels(install, TOKEN, appData)).toEqual({
    status: 'ok',
    models: [
      { id: 'gemini-paid', name: 'Gemini Paid' },
      { id: 'claude-paid', name: 'Claude Paid', group: 'External' },
      { id: 'gpt-from-update', name: 'gpt-from-update' },
      { id: 'gemini-paid-high', name: 'Gemini Paid High' },
      { id: 'independent-legacy-model', name: 'Independent Legacy Model' },
    ],
  });
  const profile = readFileSync(marker, 'utf8');
  expect(dirname(dirname(profile))).toBe(join(realpathSync(appData), 'credential-profiles'));
  expect(existsSync(profile)).toBe(false);
});

test("keeps each model's authoritative group, and the model itself when its group is unusable", async () => {
  const { install, appData } = fakeAgy('groups');
  expect(await probeAntigravitySubscriptionModels(install, TOKEN, appData)).toEqual({
    status: 'ok',
    models: [
      { id: 'late-grouped', name: 'Late Grouped', group: 'Gemini Models' },
      { id: 'gemini-grouped', name: 'Gemini Grouped', group: 'Gemini Models' },
      { id: 'claude-grouped', name: 'C'.repeat(256), group: 'Claude and GPT models' },
      { id: 'leaky-group-model', name: 'Leaky Group Model' },
      { id: 'long-group-model', name: 'Long Group Model' },
      { id: 'unnamed-group-model', name: 'Unnamed Group Model' },
      { id: 'late-update-model', name: 'Late Update Model', group: 'Late Pool' },
    ],
  });
});

test.each([
  ['empty', 'upstream'],
  ['auth', 'auth'],
] as const)('does not invent account models for a %s reply', async (outcome, failure) => {
  const { install, marker, appData } = fakeAgy(outcome);
  expect(await probeAntigravitySubscriptionModels(install, TOKEN, appData)).toEqual({
    status: 'failed',
    failure,
  });
  expect(existsSync(readFileSync(marker, 'utf8'))).toBe(false);
});
