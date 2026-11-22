import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { StepEvent } from '@cairn/shared';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createClaudeCodeBackend } from '../src/backend/claude-code.js';

const FAKE = resolve(__dirname, 'fixtures/fake-claude.mjs');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

test.each([
  [true, 'fd'],
  [false, 'env'],
])(
  'a stored setup-token reaches the real claude spawn path and the task edits its workspace (orb=%s)',
  async (inOrb, via) => {
    const dir = makeTestTempDir('fake-claude-');
    dirs.push(dir);
    const log = join(dir, 'log');
    const token = 'sk-ant-oat01-synthetic-token';
    const handle = await createClaudeCodeBackend({ inOrb, executablePath: FAKE }).createSession({
      provider: { kind: 'http', providerId: 'claude-code' },
      modelId: 'claude-sonnet-5-5',
      cwd: dir,
      prompt: 'do the thing',
      env: { CLAUDE_CODE_OAUTH_TOKEN: token, FAKE_CLAUDE_LOG: log },
    });
    const events: StepEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
      if (event.type === 'done' || event.type === 'error') break;
    }
    expect(events.at(-1)?.type).toBe('done');
    const seen = JSON.parse(readFileSync(log, 'utf8').trim());
    expect(seen).toMatchObject({
      via,
      tokenSha: createHash('sha256').update(token).digest('hex').slice(0, 12),
      apiKey: '',
      authToken: '',
    });
    expect(existsSync(join(dir, 'fake-claude-edit.txt'))).toBe(true);
  },
);
