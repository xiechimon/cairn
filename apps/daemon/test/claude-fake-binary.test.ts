import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { StepEvent } from '@cairn/shared';
import { afterEach, expect, test } from 'vitest';
import { createClaudeCodeBackend } from '../src/backend/claude-code.js';

const FAKE = resolve(__dirname, 'fixtures/fake-claude.mjs');

afterEach(() => {
  delete process.env.FAKE_CLAUDE_LOG;
});

test.each([
  [true, 'fd'],
  [false, 'env'],
])(
  'a stored setup-token reaches the real claude spawn path and the task edits its workspace (orb=%s)',
  async (inOrb, via) => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
    const log = join(dir, 'log');
    process.env.FAKE_CLAUDE_LOG = log;
    const token = 'sk-ant-oat01-synthetic-token';
    const handle = await createClaudeCodeBackend({ inOrb, executablePath: FAKE }).createSession({
      provider: { kind: 'http', providerId: 'claude-code' },
      modelId: 'claude-sonnet-5-5',
      cwd: dir,
      prompt: 'do the thing',
      env: { CLAUDE_CODE_OAUTH_TOKEN: token },
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
