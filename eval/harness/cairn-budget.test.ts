import { describe, expect, test } from 'vitest';
import { ReservationLedger } from './reserve.js';

describe('reservation ledger', () => {
  test('the start cap refuses the first reservation past it', () => {
    const ledger = new ReservationLedger({ maxStarts: 2, maxWallMinutes: 30 });
    expect(ledger.open('a').ok).toBe(true);
    expect(ledger.open('a').ok).toBe(true);
    const refused = ledger.open('a');
    expect(refused.ok).toBe(false);
    expect(ledger.snapshot().stopReason).toContain('2');
    expect(ledger.snapshot().closed).toBe(true);
  });

  test('the approved calibration cap refuses start 65 of 64', () => {
    const ledger = new ReservationLedger({ maxStarts: 64, maxWallMinutes: 30 });
    for (let i = 0; i < 64; i += 1) expect(ledger.open('calibration').ok).toBe(true);
    expect(ledger.open('calibration').ok).toBe(false);
    expect(ledger.snapshot().starts).toBe(64);
    expect(ledger.snapshot().stopReason).toContain('start cap 64');
  });

  test('the wall cap refuses the next start after thirty minutes are spent', () => {
    const ledger = new ReservationLedger({ maxStarts: 64, maxWallMinutes: 30 });
    const first = ledger.open('a');
    expect(first.ok).toBe(true);
    if (first.ok) ledger.charge(first.id, 31 * 60_000);
    expect(ledger.open('a').ok).toBe(false);
    expect(ledger.snapshot().stopReason).toContain('wall cap 30');
  });

  test('an unsettled reservation is still charged as a start', () => {
    const ledger = new ReservationLedger({ maxStarts: 1, maxWallMinutes: 30 });
    expect(ledger.open('a').ok).toBe(true);
    expect(ledger.snapshot().open).toBe(1);
    expect(ledger.open('b').ok).toBe(false);
  });

  test('a stop reason blocks every later reservation', () => {
    const ledger = new ReservationLedger({ maxStarts: 64, maxWallMinutes: 30 });
    ledger.stop('operator stop');
    expect(ledger.open('a')).toEqual({ ok: false, reason: 'operator stop' });
  });

  test('charging an unknown reservation changes nothing', () => {
    const ledger = new ReservationLedger({ maxStarts: 1, maxWallMinutes: 1 });
    ledger.charge('missing', 60_000);
    expect(ledger.snapshot().wallMs).toBe(0);
  });

  test('a negative cap is rejected', () => {
    expect(() => new ReservationLedger({ maxStarts: -1, maxWallMinutes: 30 })).toThrow();
  });
});
