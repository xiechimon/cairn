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
  test('only an explicit logged-in report reads as signed in', () => {
    expect(claudeCodeStatus(source({ auth: { state: 'logged-in' } }), true)).toEqual({
      status: '已登录',
      tone: 'ok',
    });
  });

  test('an unknown auth probe is not reported as signed in', () => {
    expect(claudeCodeStatus(source({ auth: { state: 'unknown' } }), true)).toEqual({
      status: '已安装，登录状态未知',
      tone: 'warn',
    });
  });

  test('a report without auth (older daemon) reads as installed only', () => {
    expect(claudeCodeStatus(source({}), true)).toEqual({ status: '已安装', tone: 'ok' });
  });

  test('not signed in, missing binary, missing slots, offline and no report', () => {
    expect(claudeCodeStatus(source({ auth: { state: 'not-logged-in' } }), true).status).toBe(
      '未登录',
    );
    expect(claudeCodeStatus(source({ bin: null }), true).status).toBe('未安装');
    expect(claudeCodeStatus(source({ models: [] }), true).status).toBe('已安装，未配置模型槽');
    expect(claudeCodeStatus(source({ auth: { state: 'logged-in' } }), false).tone).toBe('warn');
    expect(claudeCodeStatus(undefined, true)).toEqual({ status: '还没上报', tone: 'off' });
  });
});
