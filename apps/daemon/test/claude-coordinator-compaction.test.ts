import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { COORDINATOR_COMPACT_AT } from '@cairn/shared';
import { expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { buildClaudeSdkOptions } from '../src/backend/claude-code.js';

async function* idle(): AsyncGenerator<never> {
  await new Promise(() => {});
}

test('a Coordinator session on the bundled Claude Code auto-compacts at the product threshold', async () => {
  const home = makeTestTempDir('cairn-claude-compact-');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const options = buildClaudeSdkOptions({
    cwd: home,
    modelId: 'claude-opus-5-5',
    resumeId: null,
    sessionId: '00000000-0000-4000-8000-00000000c0de',
    disallowedTools: [],
    mcpServers: {},
    inOrb: false,
    lockedDown: true,
    compactAt: COORDINATOR_COMPACT_AT,
    abortController: new AbortController(),
    env: {
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      ANTHROPIC_API_KEY: 'sk-ant-probe-not-a-key',
    },
  });
  const session = query({ prompt: idle(), options });
  try {
    const usage = await session.getContextUsage({ detail: 'summary' });
    expect(usage.isAutoCompactEnabled).toBe(true);
    expect(usage.autoCompactThreshold).toBe(COORDINATOR_COMPACT_AT);
  } finally {
    session.close();
    releaseTestTempDir(home);
  }
}, 60_000);
