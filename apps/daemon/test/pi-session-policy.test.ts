// pi 会话运行面与信任面显式策略（#925）：三项决定各自落成可断言的口径——
//   D1 project trust = deny（钉 projectTrusted:false）+ 受保护资源在位时
//      有可观测记录（detectTrustProtectedResources 供 [trust] 行点名）；
//   D2 telemetry / 版本检查 = off（PI_TELEMETRY / PI_SKIP_VERSION_CHECK env
//      钉 + enableInstallTelemetry:false 声明——pi 缺省是 true）；
//   D3 file-backed settings = 显式声明绕过（PI_SETTINGS_BYPASS 清单 +
//      PI_DAEMON_SETTINGS 声明面，行为与清单相符）。
// 缓存保留（#927 D6）同走 env 钉面：CAIRN_PI_CACHE_RETENTION → PI_CACHE_RETENTION。
// pi 包不在测试面出现——缝纪律（backend/pi.ts 桥导入）。

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  daemonSettingsManager,
  detectTrustProtectedResources,
  PI_DAEMON_SETTINGS,
  PI_SETTINGS_BYPASS,
  piSessionPolicyLine,
  piUnattendedEnvPins,
  resolvePiCacheRetention,
  TRUST_PROTECTED_ENTRIES,
} from '../src/backend/pi.js';

function worktree(): string {
  return mkdtempSync(join(tmpdir(), 'cairn-trust-'));
}

function plant(dir: string, rel: string, content = 'x'): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

describe('#925 D1 project trust：deny + 受保护资源可观测', () => {
  test('无受保护资源 → 空集（bare .pi 目录不算，pi security.md 同律）', () => {
    const dir = worktree();
    plant(dir, 'README.md');
    mkdirSync(join(dir, '.pi'));
    expect(detectTrustProtectedResources(dir)).toEqual([]);
  });

  test('.pi/SYSTEM.md 在位 → 点名（denied 记录的数据面，不再静默）', () => {
    const dir = worktree();
    plant(dir, '.pi/SYSTEM.md', 'HIJACKED SYSTEM PROMPT');
    expect(detectTrustProtectedResources(dir)).toEqual(['.pi/SYSTEM.md']);
  });

  test('八件受保护资源全枚举（词表 = pi security.md §project trust）', () => {
    const dir = worktree();
    for (const entry of TRUST_PROTECTED_ENTRIES) {
      plant(dir, `.pi/${entry}`);
    }
    expect(detectTrustProtectedResources(dir)).toEqual(
      TRUST_PROTECTED_ENTRIES.map((e) => `.pi/${e}`),
    );
  });

  test('会话 settings 面：projectTrusted=false（deny 决定）', () => {
    expect(daemonSettingsManager().isProjectTrusted()).toBe(false);
  });
});

describe('#925 D2/D3 telemetry off + settings 绕过声明', () => {
  test('PI_DAEMON_SETTINGS 声明面：telemetry 显式关、缓存预热显式关、压缩开', () => {
    expect(PI_DAEMON_SETTINGS).toEqual({
      compaction: { enabled: true },
      enableInstallTelemetry: false,
      cacheWarming: 'off',
    });
  });

  test('声明 settings 与会话 settings 行为相符（绕过清单不是空话）', () => {
    const settings = daemonSettingsManager().getSettings();
    expect(settings.enableInstallTelemetry).toBe(false);
    expect(settings.cacheWarming).toBe('off');
    expect(settings.compaction?.enabled).toBe(true);
  });

  test('PI_SETTINGS_BYPASS 清单盖住票面点名的四族（trust/retry/modelOverrides/httpProxy）', () => {
    const names = PI_SETTINGS_BYPASS.map((entry) => entry.setting);
    for (const expected of ['defaultProjectTrust', 'retry', 'modelOverrides', 'httpProxy']) {
      expect(names, `bypass list missing ${expected}`).toContain(expected);
    }
    // 每条都有「绕过后由谁负责」的说明——清单可读性即验收面。
    expect(PI_SETTINGS_BYPASS.every((entry) => entry.policy.length > 0)).toBe(true);
  });

  test('env 钉：telemetry=0、版本检查跳过、离线、缓存保留缺省 short；已有显式值不被抢', () => {
    expect(piUnattendedEnvPins({})).toEqual({
      PI_OFFLINE: '1',
      PI_TELEMETRY: '0',
      PI_SKIP_VERSION_CHECK: '1',
      PI_CACHE_RETENTION: 'short',
    });
    // ?? 语义（PI_OFFLINE 既有纪律同形）：已显式设置的 env 位不进钉集。
    const pins = piUnattendedEnvPins({ PI_TELEMETRY: '1', PI_OFFLINE: '0' });
    expect(pins).not.toHaveProperty('PI_TELEMETRY');
    expect(pins).not.toHaveProperty('PI_OFFLINE');
    expect(pins.PI_SKIP_VERSION_CHECK).toBe('1');
  });
});

describe('#927 D6 缓存保留：显式设置（配置可读）', () => {
  test('CAIRN_PI_CACHE_RETENTION 未设/乱值 → short（缺省显式化，请求面零漂移）', () => {
    expect(resolvePiCacheRetention({})).toBe('short');
    expect(resolvePiCacheRetention({ CAIRN_PI_CACHE_RETENTION: 'LONG' })).toBe('short');
    expect(resolvePiCacheRetention({ CAIRN_PI_CACHE_RETENTION: '1h' })).toBe('short');
  });

  test('=long → long（anthropic ttl 1h / openai prompt_cache_retention 24h 由 pi 适配器落）', () => {
    expect(resolvePiCacheRetention({ CAIRN_PI_CACHE_RETENTION: 'long' })).toBe('long');
  });

  test('策略行可读：trust/telemetry/version-check/cache-retention/settings 五位齐', () => {
    const line = piSessionPolicyLine({ CAIRN_PI_CACHE_RETENTION: 'long' });
    expect(line).toContain('trust=deny');
    expect(line).toContain('telemetry=off');
    expect(line).toContain('version-check=off');
    expect(line).toContain('cache-retention=long');
    expect(line).toContain('settings=in-memory');
  });

  test('策略行取生效值不谎报：操作员显式 PI_TELEMETRY=1 / 直钉 PI_CACHE_RETENTION 时逐位翻转', () => {
    // piUnattendedEnvPins 的 ?? 语义 = 显式 env 压过宿主钉——宣告行必须跟着
    // 生效值走，否则「telemetry=off」就是谎报（code-review Standards 轴）。
    const line = piSessionPolicyLine({ PI_TELEMETRY: '1', PI_CACHE_RETENTION: 'long' });
    expect(line).toContain('telemetry=on');
    expect(line).toContain('cache-retention=long');
    // PI_SKIP_VERSION_CHECK 的 pi 侧闸是字符串真值判定：空串 = 检查仍开。
    expect(piSessionPolicyLine({ PI_SKIP_VERSION_CHECK: '' })).toContain('version-check=on');
  });
});
