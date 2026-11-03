import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, test } from 'vitest';
import { buildClaudeSdkOptions } from '../src/backend/claude-code.js';

const scrubbed = { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' };

function options(patch: {
  env?: Record<string, string>;
  inOrb?: boolean;
  lockedDown?: boolean;
  disallowedTools?: string[];
}) {
  return buildClaudeSdkOptions({
    cwd: '/tmp/ws',
    modelId: 'sonnet',
    resumeId: null,
    sessionId: 'scrub-test',
    disallowedTools: patch.disallowedTools ?? ['AskUserQuestion'],
    mcpServers: {},
    inOrb: patch.inOrb ?? false,
    lockedDown: patch.lockedDown ?? false,
    abortController: new AbortController(),
    ...(patch.env !== undefined ? { env: patch.env } : {}),
  });
}

async function decide(canUseTool: CanUseTool | undefined, toolName: string) {
  expect(canUseTool).toBeDefined();
  const result = await canUseTool?.(
    toolName,
    { command: 'true' },
    { signal: new AbortController().signal, toolUseID: 'tool-1', requestId: 'request-1' },
  );
  return result?.behavior;
}

describe('subprocess env scrub forces Claude Code to default permission mode', () => {
  test.each([true, false])(
    'with scrub a worker step (inOrb=%s) asks no one: every tool the step allows is approved',
    async (inOrb) => {
      const opts = options({ env: scrubbed, inOrb });
      expect(opts.permissionMode).toBe('default');
      expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
      for (const tool of ['Bash', 'WebFetch', 'Write', 'Edit', 'mcp__cairn__set_task_meta']) {
        expect(await decide(opts.canUseTool, tool)).toBe('allow');
      }
      expect(opts.env?.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('1');
    },
  );

  test('with scrub a disallowed tool is still denied', async () => {
    const opts = options({
      env: scrubbed,
      inOrb: true,
      disallowedTools: ['AskUserQuestion', 'Edit', 'Write'],
    });
    expect(opts.disallowedTools).toEqual(['AskUserQuestion', 'Edit', 'Write']);
    expect(await decide(opts.canUseTool, 'Write')).toBe('deny');
    expect(await decide(opts.canUseTool, 'Edit')).toBe('deny');
    expect(await decide(opts.canUseTool, 'AskUserQuestion')).toBe('deny');
    expect(await decide(opts.canUseTool, 'Read')).toBe('allow');
  });

  test('without scrub the step keeps bypass mode and no permission callback', () => {
    const host = options({});
    expect(host.permissionMode).toBe('bypassPermissions');
    expect(host.canUseTool).toBeUndefined();
    const orb = options({ inOrb: true });
    expect(orb.permissionMode).toBe('bypassPermissions');
    expect(orb.allowDangerouslySkipPermissions).toBe(true);
    expect(orb.canUseTool).toBeUndefined();
  });

  test('a locked-down host step keeps dontAsk, its allowlist and no Bash even with scrub', () => {
    const opts = options({
      env: scrubbed,
      lockedDown: true,
      disallowedTools: ['AskUserQuestion', 'Edit', 'Write'],
    });
    expect(opts.permissionMode).toBe('dontAsk');
    expect(opts.allowedTools).toEqual(['mcp__cairn', 'Read', 'Glob', 'Grep']);
    expect(opts.disallowedTools).toEqual(['AskUserQuestion', 'Edit', 'Write', 'Bash']);
    expect(opts.canUseTool).toBeUndefined();
  });
});
