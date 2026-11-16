import type { ModelSource } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { claudeCodeStatus } from '../src/resources/provider-editors.js';

const SLOTS = [{ id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', slot: 'default-sonnet' }];

function source(fields: Partial<ModelSource>): ModelSource {
  return {
    runtime: 'claude-code',
    installed: true,
    hostname: 'box',
    bin: { path: '/usr/local/bin/claude', version: '2.1.316' },
    models: SLOTS,
    ...fields,
  };
}

describe('claudeCodeStatus', () => {
  test('an installed Claude Code with a team subscription is ready whatever the local login says', () => {
    for (const state of ['logged-in', 'not-logged-in', 'unknown'] as const) {
      expect(claudeCodeStatus(source({ auth: { state } }), true, true)).toEqual({
        status: '已安装，用团队的 Claude 订阅',
        tone: 'ok',
      });
    }
  });

  test('without a usable team subscription it asks for one, even when the Runner is signed in', () => {
    expect(claudeCodeStatus(source({ auth: { state: 'logged-in' } }), true, false)).toEqual({
      status: '已安装，添加 Claude 订阅后才能用',
      tone: 'warn',
    });
  });

  test('missing binary, missing slots, offline and no report', () => {
    expect(claudeCodeStatus(source({ bin: null }), true, true).status).toBe('未安装');
    expect(claudeCodeStatus(source({ models: [] }), true, true).status).toBe(
      '已安装，未配置模型槽',
    );
    expect(claudeCodeStatus(source({}), false, true).tone).toBe('warn');
    expect(claudeCodeStatus(undefined, true, true)).toEqual({ status: '还没上报', tone: 'off' });
  });
});
