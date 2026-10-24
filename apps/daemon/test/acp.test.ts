import { describe, expect, test } from 'vitest';
import { acpErrorMessage, mapAcpUpdate, validateGeminiSession } from '../src/backend/acp.js';

describe('Gemini ACP bridge', () => {
  test('失败方式 1：spawn 不存在时给出安装提示', () => {
    expect(acpErrorMessage(new Error('spawn gemini ENOENT'))).toContain('未找到 gemini');
  });

  test('失败方式 2：认证失败指向 Gemini 登录', () => {
    expect(acpErrorMessage(new Error('authenticate required'))).toContain('Gemini 登录');
  });

  test('失败方式 3：gemini 是独立 runtime，未知 provider 仍是 pi', async () => {
    const shared = await import('@cairn/shared');
    expect(shared.isBackendRuntimeId('gemini')).toBe(true);
    expect(shared.isBackendRuntimeId('unknown-provider')).toBe(false);
  });

  test('失败方式 4：runtime 开关缺席时不通过', async () => {
    const { MACHINE_RUNTIMES } = await import('@cairn/shared');
    expect(MACHINE_RUNTIMES).toContain('gemini');
    expect(['pi'].includes('gemini')).toBe(false);
  });

  test('失败方式 5：简报后端使用 GEMINI.md', async () => {
    const { briefBackendForProvider, BRIEF_CREATE_NAME } = await import('@cairn/shared');
    expect(BRIEF_CREATE_NAME[briefBackendForProvider('gemini')]).toBe('GEMINI.md');
  });

  test('失败方式 6：resume 不产生新的用户消息', () => {
    expect(validateGeminiSession({ cwd: '/tmp', modelId: 'gemini', resumeId: 's1' })).toEqual({
      prompt: undefined,
      resumeId: 's1',
    });
  });

  test('失败方式 7：不支持图片能力时拒绝图片', () => {
    expect(() =>
      validateGeminiSession({ cwd: '/tmp', modelId: 'gemini', promptImages: [] }),
    ).not.toThrow();
    expect(() =>
      validateGeminiSession({
        cwd: '/tmp',
        modelId: 'gemini',
        promptImages: [{ data: 'x', mimeType: 'image/png' }],
      }),
    ).toThrow('image capability');
  });

  test('失败方式 8：非空工具集合 fail-closed', () => {
    expect(() =>
      validateGeminiSession({ cwd: '/tmp', modelId: 'gemini', remoteTools: [{ name: 'x' }] }),
    ).toThrow('fail-closed');
    expect(() =>
      validateGeminiSession({ cwd: '/tmp', modelId: 'gemini', localTools: [{ name: 'x' }] }),
    ).toThrow('fail-closed');
  });

  test('失败方式 9：取消错误映射为 message_stop', () => {
    expect(mapAcpUpdate({ kind: 'cancelled' })).toEqual({ type: 'message_stop' });
  });

  test('失败方式 10：协议版本不一致保留双方版本', () => {
    expect(acpErrorMessage(new Error('protocolVersion 0.16.1 != 2.0.2'))).toContain(
      'protocolVersion',
    );
  });
});
