import { describe, expect, test } from 'vitest';
import { buildPiSessionSettings } from '../src/backend/pi.js';
import { PI_RETRY_SETTINGS } from '../src/backend/pi-retry.js';
import { RETRY_STORM_MAX } from '../src/runner.js';

describe('retry surface explicitly wired into session settings (#926 acceptance 1)', () => {
  test('buildPiSessionSettings carries an explicit retry block, and it is exactly the PI_RETRY_SETTINGS object', () => {
    const settings = buildPiSessionSettings();
    expect(settings.retry).toBe(PI_RETRY_SETTINGS);
    expect(settings.compaction).toEqual({ enabled: true });
  });

  test('explicit values align with docs/settings.md §Network and retries (independent source, not self-certification)', () => {
    expect(PI_RETRY_SETTINGS.enabled).toBe(true);
    expect(PI_RETRY_SETTINGS.maxRetries).toBe(3);
    expect(PI_RETRY_SETTINGS.baseDelayMs).toBe(2000);
    expect(PI_RETRY_SETTINGS.maxAgentDelayMs).toBe(60000);
    expect(PI_RETRY_SETTINGS.provider.maxRetries).toBe(0);
  });
});

describe('guardrail constants consistent with settings (#926 acceptance 3)', () => {
  test('RETRY_STORM_MAX is same-source with the pi session retry.maxRetries, never decoupled', () => {
    expect(RETRY_STORM_MAX).toBe(buildPiSessionSettings().retry.maxRetries);
    expect(RETRY_STORM_MAX).toBe(PI_RETRY_SETTINGS.maxRetries);
  });
});
