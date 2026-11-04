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

describe('#925 D1 project trust: deny + protected resources observable', () => {
  test('no protected resources → empty set (a bare .pi directory does not count, same rule as pi security.md)', () => {
    const dir = worktree();
    plant(dir, 'README.md');
    mkdirSync(join(dir, '.pi'));
    expect(detectTrustProtectedResources(dir)).toEqual([]);
  });

  test(".pi/SYSTEM.md present → named (the denied record's data surface, no longer silent)", () => {
    const dir = worktree();
    plant(dir, '.pi/SYSTEM.md', 'HIJACKED SYSTEM PROMPT');
    expect(detectTrustProtectedResources(dir)).toEqual(['.pi/SYSTEM.md']);
  });

  test('all eight protected resources enumerated (vocabulary = pi security.md §project trust)', () => {
    const dir = worktree();
    for (const entry of TRUST_PROTECTED_ENTRIES) {
      plant(dir, `.pi/${entry}`);
    }
    expect(detectTrustProtectedResources(dir)).toEqual(
      TRUST_PROTECTED_ENTRIES.map((e) => `.pi/${e}`),
    );
  });

  test('session settings surface: projectTrusted=false (decided by deny)', () => {
    expect(daemonSettingsManager().isProjectTrusted()).toBe(false);
  });
});

describe('#925 D2/D3 telemetry off + settings bypass declaration', () => {
  test('PI_DAEMON_SETTINGS declaration surface: telemetry explicitly off, cache warmup explicitly off, compaction on', () => {
    expect(PI_DAEMON_SETTINGS).toEqual({
      compaction: { enabled: true },
      enableInstallTelemetry: false,
      cacheWarming: 'off',
    });
  });

  test('declared settings match session settings behavior (the bypass list is not lip service)', () => {
    const settings = daemonSettingsManager().getSettings();
    expect(settings.enableInstallTelemetry).toBe(false);
    expect(settings.cacheWarming).toBe('off');
    expect(settings.compaction?.enabled).toBe(true);
  });

  test('PI_SETTINGS_BYPASS list covers the four families named on the ticket (trust/retry/modelOverrides/httpProxy)', () => {
    const names = PI_SETTINGS_BYPASS.map((entry) => entry.setting);
    for (const expected of ['defaultProjectTrust', 'retry', 'modelOverrides', 'httpProxy']) {
      expect(names, `bypass list missing ${expected}`).toContain(expected);
    }
    expect(PI_SETTINGS_BYPASS.every((entry) => entry.policy.length > 0)).toBe(true);
  });

  test('env pins: telemetry=0, version check skipped, offline, cache retention default short; existing explicit values are not overridden', () => {
    expect(piUnattendedEnvPins({})).toEqual({
      PI_OFFLINE: '1',
      PI_TELEMETRY: '0',
      PI_SKIP_VERSION_CHECK: '1',
      PI_CACHE_RETENTION: 'short',
    });
    const pins = piUnattendedEnvPins({ PI_TELEMETRY: '1', PI_OFFLINE: '0' });
    expect(pins).not.toHaveProperty('PI_TELEMETRY');
    expect(pins).not.toHaveProperty('PI_OFFLINE');
    expect(pins.PI_SKIP_VERSION_CHECK).toBe('1');
  });
});

describe('#927 D6 cache retention: explicit setting (config readable)', () => {
  test('CAIRN_PI_CACHE_RETENTION unset/garbage → short (default made explicit, zero drift on the request surface)', () => {
    expect(resolvePiCacheRetention({})).toBe('short');
    expect(resolvePiCacheRetention({ CAIRN_PI_CACHE_RETENTION: 'LONG' })).toBe('short');
    expect(resolvePiCacheRetention({ CAIRN_PI_CACHE_RETENTION: '1h' })).toBe('short');
  });

  test('=long → long (anthropic ttl 1h / openai prompt_cache_retention 24h applied by the pi adapter)', () => {
    expect(resolvePiCacheRetention({ CAIRN_PI_CACHE_RETENTION: 'long' })).toBe('long');
  });

  test('policy line readable: all five of trust/telemetry/version-check/cache-retention/settings present', () => {
    const line = piSessionPolicyLine({ CAIRN_PI_CACHE_RETENTION: 'long' });
    expect(line).toContain('trust=deny');
    expect(line).toContain('telemetry=off');
    expect(line).toContain('version-check=off');
    expect(line).toContain('cache-retention=long');
    expect(line).toContain('settings=in-memory');
  });

  test('policy line reports the effective value without lying: flips bit by bit when the operator sets PI_TELEMETRY=1 / pins PI_CACHE_RETENTION directly', () => {
    const line = piSessionPolicyLine({ PI_TELEMETRY: '1', PI_CACHE_RETENTION: 'long' });
    expect(line).toContain('telemetry=on');
    expect(line).toContain('cache-retention=long');
    expect(piSessionPolicyLine({ PI_SKIP_VERSION_CHECK: '' })).toContain('version-check=on');
  });
});
