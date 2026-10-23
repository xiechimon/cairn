// 代理探测 + 回环 no-proxy 合并（#297：代理 shell 下 machine API 全 401，
// 首发实测 env -u 移除代理痊愈、置空无效——EnvHttpProxyAgent 自读 env，
// 覆盖必须走构造参数 noProxy）。
//
// 失败方式枚举（#297 票面）：
//   1. 代理 env 在 + --server 回环 → 未合并 no-proxy → 请求走代理 → 401 崩溃循环
//   2. NO_PROXY 已有条目 → 合并不得吞掉既有条目
//   3. host 已在 NO_PROXY → 不得重复追加
//   4. 非回环 server / 缺 serverUrl / 坏 URL → 不注入（保持 env 原语义）

import { describe, expect, test } from 'vitest';
import { detectProxyEnv, loopbackNoProxy } from '../src/proxy.js';

describe('loopbackNoProxy', () => {
  test('127.0.0.1 server 合并进既有 NO_PROXY，不吞条目', () => {
    expect(loopbackNoProxy({ NO_PROXY: 'example.com' }, 'http://127.0.0.1:8791')).toBe(
      'example.com,127.0.0.1',
    );
  });

  test('无 NO_PROXY 时单独返回回环 host', () => {
    expect(loopbackNoProxy({}, 'http://localhost:8787')).toBe('localhost');
  });

  test('IPv6 字面量（带括号形态）剥壳合并', () => {
    expect(loopbackNoProxy({}, 'http://[::1]:8787')).toBe('::1');
  });

  test('host 已在 NO_PROXY 列表则原样保持', () => {
    expect(loopbackNoProxy({ NO_PROXY: '127.0.0.1,other' }, 'http://127.0.0.1:8791')).toBe(
      '127.0.0.1,other',
    );
  });

  test('小写 no_proxy 变体同读', () => {
    expect(loopbackNoProxy({ no_proxy: 'a.com' }, 'http://127.0.0.1:1')).toBe('a.com,127.0.0.1');
  });

  test('非回环 server 不注入', () => {
    expect(loopbackNoProxy({}, 'https://cairn.example.com')).toBeUndefined();
  });

  test('缺 serverUrl 或坏 URL 不注入', () => {
    expect(loopbackNoProxy({}, undefined)).toBeUndefined();
    expect(loopbackNoProxy({}, 'not-a-url')).toBeUndefined();
  });
});

describe('detectProxyEnv', () => {
  test('HTTP_PROXY/HTTPS_PROXY 大小写变体探测', () => {
    expect(detectProxyEnv({ HTTP_PROXY: 'http://p:1' })).toBe('http://p:1');
    expect(detectProxyEnv({ https_proxy: 'http://p:2' })).toBe('http://p:2');
    expect(detectProxyEnv({})).toBeNull();
  });
});
