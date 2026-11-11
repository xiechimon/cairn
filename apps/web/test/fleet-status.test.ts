import { describe, expect, it } from 'vitest';
import { fleetStatus, fleetStatusLine, fleetSummary, machineStateLabel } from '../src/board/fleet-status.js';
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
  it('writes both counts and the offline machine names', () => {
    expect(fleetStatusLine({ online: 2, offline: 1, offlineNames: ['xmonsMac'] }, t)).toBe(
      '2 台在线 · 1 台离线（xmonsMac）',
    );
  });

  it('joins several offline names', () => {
    expect(fleetStatusLine({ online: 0, offline: 2, offlineNames: ['a', 'b'] }, t)).toBe(
      '0 台在线 · 2 台离线（a、b）',
    );
  });

  it('is empty when nothing is offline', () => {
    expect(fleetStatusLine({ online: 3, offline: 0, offlineNames: [] }, t)).toBeNull();
  });
});

describe('fleetSummary', () => {
  it('is a short count line with the offline names as the tooltip', () => {
    expect(fleetSummary({ online: 2, offline: 1, offlineNames: ['xmonsMac'] }, t)).toEqual({
      label: '2 在线 · 1 离线',
      short: '2/3',
      title: '2 台在线 · 1 台离线（xmonsMac）',
      tone: 'offline',
    });
  });

  it('is neutral and nameless when every machine is online', () => {
    expect(fleetSummary({ online: 3, offline: 0, offlineNames: [] }, t)).toEqual({
      label: '3 台在线',
      short: '3/3',
      title: '3 台在线',
      tone: 'online',
    });
  });

  it('is absent without machines', () => {
    expect(fleetSummary({ online: 0, offline: 0, offlineNames: [] }, t)).toBeNull();
  });
});

describe('machineStateLabel', () => {
  it('reads offline for an offline machine whatever it was running', () => {
    expect(machineStateLabel(machine({ online: false, runningSteps: 3 }), t)).toBe('离线');
  });

  it('reads online and idle for a quiet machine', () => {
    expect(machineStateLabel(machine({ runningSteps: 0 }), t)).toBe('在线 · 空闲');
  });

  it('reads the running count against the limit', () => {
    expect(machineStateLabel(machine({ runningSteps: 2, maxConcurrent: 8 }), t)).toBe(
      '在线 · 2/8 在跑',
    );
    expect(machineStateLabel(machine({ runningSteps: 2 }), t)).toBe('在线 · 2 在跑');
  });
});
