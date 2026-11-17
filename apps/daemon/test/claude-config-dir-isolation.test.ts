import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { isolateClaudeConfigDir } from '../src/config.js';

describe('isolateClaudeConfigDir', () => {
  test('defaults to a directory under the daemon home', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(isolateClaudeConfigDir('/cairn-home', env)).toBe(join('/cairn-home', 'claude'));
    expect(env.CLAUDE_CONFIG_DIR).toBe(join('/cairn-home', 'claude'));
  });

  test('keeps an explicit CLAUDE_CONFIG_DIR', () => {
    const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: '/custom/claude' };
    expect(isolateClaudeConfigDir('/cairn-home', env)).toBe('/custom/claude');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/custom/claude');
  });

  test('treats an empty value as unset', () => {
    const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: '' };
    isolateClaudeConfigDir('/cairn-home', env);
    expect(env.CLAUDE_CONFIG_DIR).toBe(join('/cairn-home', 'claude'));
  });
});
