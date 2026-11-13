import { describe, expect, it } from 'vitest';
import {
  browserCapabilityInstalled,
  desktopControlInstalled,
  desktopControlOnline,
} from '../src/board/machine-capabilities.js';
import type { MachineRow } from '../src/fixtures/records.js';

const machine = (patch: Partial<MachineRow> = {}): MachineRow => ({
  id: 'm1',
  name: 'omarchy',
  online: true,
  ...patch,
});

const computer = (online = true, state: 'running' | 'stopped' | 'failed' = 'running') => ({
  id: 'c1',
  scopeKey: 'chief:1',
  state,
  controlHolder: 'none' as const,
  browserEnabled: false,
  handoffReason: null,
  machine: { id: 'm1', name: 'omarchy', online },
});

describe('machine computer capability badges', () => {
  it('desktop control is installed from ownComputer or a computer row', () => {
    expect(desktopControlInstalled(machine(), null)).toBe(false);
    expect(
      desktopControlInstalled(
        machine({ capabilities: { mcpServers: [], skills: [], ownComputer: true } }),
        null,
      ),
    ).toBe(true);
    expect(desktopControlInstalled(machine(), computer())).toBe(true);
  });

  it('browser is installed only when the machine reports browser capability', () => {
    expect(browserCapabilityInstalled(machine(), null)).toBe(false);
    expect(
      browserCapabilityInstalled(
        machine({ capabilities: { mcpServers: [], skills: [], computer: true } }),
        null,
      ),
    ).toBe(false);
    expect(
      browserCapabilityInstalled(
        machine({ capabilities: { mcpServers: [], skills: [], browser: true } }),
        null,
      ),
    ).toBe(true);
    expect(browserCapabilityInstalled(machine(), computer())).toBe(false);
  });

  it('desktop control is online only while the machine and computer can show a screen', () => {
    expect(desktopControlOnline(machine({ online: false }), computer())).toBe(false);
    expect(desktopControlOnline(machine(), computer(false))).toBe(false);
    expect(desktopControlOnline(machine(), computer(true, 'failed'))).toBe(false);
    expect(desktopControlOnline(machine(), computer())).toBe(true);
    expect(
      desktopControlOnline(
        machine({ capabilities: { mcpServers: [], skills: [], ownComputer: true } }),
        null,
      ),
    ).toBe(true);
    expect(desktopControlOnline(machine(), null)).toBe(false);
  });
});
