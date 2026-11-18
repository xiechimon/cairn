import { describe, expect, it } from 'vitest';
import { fleetStatus, fleetStatusLine } from '../src/board/fleet-status.js';
import type { MachineRow } from '../src/fixtures/records.js';
import type { TFunc, TVars } from '../src/i18n/translate.js';

const machine = (patch: Partial<MachineRow>): MachineRow => ({
  id: 'm1',
  name: 'omarchy',
  online: true,
  ...patch,
});

const t: TFunc = (key: string, vars?: TVars) =>
  key.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name]));

describe('fleetStatus', () => {
  it('counts online and offline machines and names the offline ones', () => {
    const status = fleetStatus([
      machine({ id: 'a', name: 'omarchy' }),
      machine({ id: 'b', name: 'ci-box' }),
      machine({ id: 'c', name: 'xmonsMac', online: false }),
    ]);
    expect(status).toEqual({ online: 2, offline: 1, offlineNames: ['xmonsMac'] });
  });

  it('ignores machines whose online flag is unknown', () => {
    expect(fleetStatus([machine({ online: undefined })])).toEqual({
      online: 0,
      offline: 0,
      offlineNames: [],
    });
  });

  it('is empty without machines', () => {
    expect(fleetStatus([])).toEqual({ online: 0, offline: 0, offlineNames: [] });
  });
});

describe('fleetStatusLine', () => {
  it('writes the offline count and names, with no online count', () => {
    expect(fleetStatusLine({ online: 2, offline: 1, offlineNames: ['xmonsMac'] }, t)).toBe(
      '1 台离线（xmonsMac）',
    );
  });

  it('joins several offline names', () => {
    expect(fleetStatusLine({ online: 0, offline: 2, offlineNames: ['a', 'b'] }, t)).toBe(
      '2 台离线（a、b）',
    );
  });

  it('is empty when nothing is offline', () => {
    expect(fleetStatusLine({ online: 3, offline: 0, offlineNames: [] }, t)).toBeNull();
  });
});
