import { describe, expect, test } from 'vitest';
import { ApiError } from '../src/api/client.js';
import { describeError } from '../src/lib/error-copy.js';

const t = (source: string) => source;

describe('describeError', () => {
  test('maps known ApiError reason codes without leaking raw error text', () => {
    const err = new ApiError(409, 'raw developer prose', 'already-started');
    const out = describeError(err, t);
    expect(out).toBe('这个任务已经开始过，无法退回待开始。');
    expect(out).not.toContain('raw developer prose');
  });

  test('preserves safe server prose and maps generic or noisy HTTP status messages', () => {
    expect(describeError(new ApiError(403, 'Forbidden'), t)).toBe('没有操作权限，请重新登录后重试。');
    expect(describeError(new ApiError(404, 'Not found'), t)).toBe('目标已不存在，请刷新后重试。');
    expect(describeError(new ApiError(409, 'PR #43 is already merged. Create a new task.'), t)).toBe(
      'PR #43 is already merged. Create a new task.',
    );
    expect(describeError(new ApiError(500, 'upstream refused'), t)).toBe('upstream refused');
    expect(describeError(new ApiError(429, 'Too many requests'), t)).toBe('请求过于频繁，请稍后重试。');
    expect(describeError(new ApiError(502, 'Bad Gateway'), t)).toBe('服务暂时异常，请稍后重试。');
    expect(describeError(new ApiError(400, 'invalid body at modelId: Required'), t)).toBe(
      '请求未通过，请检查填写内容后重试。',
    );
  });

  test('maps network failures and ignores unknown raw strings', () => {
    expect(describeError(new TypeError('Failed to fetch'), t)).toBe('网络连接异常，请检查网络后重试。');
    expect(describeError(new Error('raw internal stack message'), t)).toBeNull();
  });

  test('a browser refusal or a script fault is not called a network failure', () => {
    expect(describeError(new TypeError('Load failed'), t)).toBe('网络连接异常，请检查网络后重试。');
    expect(describeError(new TypeError('Network unavailable'), t)).toBe('网络连接异常，请检查网络后重试。');
    expect(describeError(new TypeError('Permissions check failed'), t)).toBeNull();
    expect(describeError(new TypeError('crypto.randomUUID is not a function'), t)).toBeNull();
  });
});
