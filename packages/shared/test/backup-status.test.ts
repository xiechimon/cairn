import { describe, expect, test } from 'vitest';
import {
  BACKUP_STALE_AFTER_MS,
  type BackupStatus,
  backupHealthSchema,
  backupNotice,
} from '../src/records/backup-status.js';

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const succeeded = (at: number): BackupStatus => ({
  host: 'omarchy',
  lastRunAt: at,
  lastRunResult: 'success',
  lastRunExitStatus: '0',
  lastSuccessAt: at,
});

describe('backupNotice', () => {
  test('a successful run inside the stale window does not warn, up to the boundary', () => {
    expect(backupNotice({ state: 'recorded', status: succeeded(NOW - HOUR) }, NOW)).toBeNull();
    expect(
      backupNotice({ state: 'recorded', status: succeeded(NOW - BACKUP_STALE_AFTER_MS) }, NOW),
    ).toBeNull();
  });

  test('a last success older than 2 hours warns as stale with whole hours', () => {
    expect(
      backupNotice({ state: 'recorded', status: succeeded(NOW - BACKUP_STALE_AFTER_MS - 1) }, NOW),
    ).toEqual({ kind: 'stale', host: 'omarchy', hours: 2 });
    expect(
      backupNotice({ state: 'recorded', status: succeeded(NOW - 13 * 24 * HOUR) }, NOW),
    ).toEqual({ kind: 'stale', host: 'omarchy', hours: 312 });
  });

  test('a failed latest run warns at once and names the systemd result', () => {
    expect(
      backupNotice(
        {
          state: 'recorded',
          status: {
            host: 'omarchy',
            lastRunAt: NOW - 60_000,
            lastRunResult: 'exit-code',
            lastRunExitStatus: '255',
            lastSuccessAt: NOW - HOUR - 60_000,
          },
        },
        NOW,
      ),
    ).toEqual({ kind: 'failing', host: 'omarchy', detail: 'exit-code 255', hours: 1 });
  });

  test('a failed run with a recent success reports zero hours, and no success reports null', () => {
    const base = { host: 'omarchy', lastRunAt: NOW - 60_000, lastRunExitStatus: '' };
    expect(
      backupNotice(
        {
          state: 'recorded',
          status: { ...base, lastRunResult: 'timeout', lastSuccessAt: NOW - 30 * 60_000 },
        },
        NOW,
      ),
    ).toEqual({ kind: 'failing', host: 'omarchy', detail: 'timeout', hours: 0 });
    expect(
      backupNotice(
        { state: 'recorded', status: { ...base, lastRunResult: 'signal', lastSuccessAt: null } },
        NOW,
      ),
    ).toEqual({ kind: 'failing', host: 'omarchy', detail: 'signal', hours: null });
  });

  test('a success result without a success time counts from the run time', () => {
    expect(
      backupNotice(
        {
          state: 'recorded',
          status: { ...succeeded(NOW - 3 * HOUR), lastSuccessAt: null },
        },
        NOW,
      ),
    ).toEqual({ kind: 'stale', host: 'omarchy', hours: 3 });
  });

  test('an unreadable status warns; no status and no data stay silent', () => {
    expect(backupNotice({ state: 'unreadable' }, NOW)).toEqual({ kind: 'unreadable' });
    expect(backupNotice({ state: 'none' }, NOW)).toBeNull();
    expect(backupNotice(null, NOW)).toBeNull();
    expect(backupNotice(undefined, NOW)).toBeNull();
  });
});

describe('backupHealthSchema', () => {
  test('accepts the three states and rejects a non-health payload', () => {
    expect(backupHealthSchema.safeParse({ state: 'none' }).success).toBe(true);
    expect(backupHealthSchema.safeParse({ state: 'unreadable' }).success).toBe(true);
    expect(
      backupHealthSchema.safeParse({ state: 'recorded', status: succeeded(NOW) }).success,
    ).toBe(true);
    expect(backupHealthSchema.safeParse([]).success).toBe(false);
    expect(
      backupHealthSchema.safeParse({ state: 'recorded', status: { host: 'omarchy' } }).success,
    ).toBe(false);
  });
});
