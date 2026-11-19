import { COMPUTER_DESKTOP_TOOLS, COMPUTER_TOOLS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  COORDINATOR_COMPUTER_TOOL_OFFERS,
  coordinatorToolDefs,
} from '../src/services/coordinator-tool-defs.js';
import { isCoordinatorComputerTool } from '../src/services/machine-relay.js';

const computerNames = (
  desktopTools: boolean,
  vmComputer = desktopTools,
  ownComputer = desktopTools,
) =>
  coordinatorToolDefs({ desktopTools, vmComputer, ownComputer })
    .map((def) => def.name)
    .filter((name) => (COMPUTER_TOOLS as readonly string[]).includes(name))
    .sort();

describe('Coordinator computer tool offers', () => {
  test('every computer tool is either offered or withheld with a reason', () => {
    expect(Object.keys(COORDINATOR_COMPUTER_TOOL_OFFERS).sort()).toEqual(
      [...COMPUTER_TOOLS].sort(),
    );
    for (const offer of Object.values(COORDINATOR_COMPUTER_TOOL_OFFERS)) {
      if ('withheld' in offer) expect(offer.withheld.length).toBeGreaterThan(10);
    }
  });

  test('a team whose machines report a computer gets every offered tool and nothing withheld', () => {
    const offered = COMPUTER_TOOLS.filter(
      (name) => 'offered' in COORDINATOR_COMPUTER_TOOL_OFFERS[name],
    ).sort();
    expect(computerNames(true)).toEqual(offered);
  });

  test("the user's Mac tools are offered only when the user's Mac is, and keep the Mac prefix", () => {
    expect(computerNames(true, true, false)).not.toContain('user_computer_observe');
    const mac = ['user_computer_act', 'user_computer_observe', 'user_computer_shell'];
    expect(computerNames(false, false, true).filter((name) => name.startsWith('user_'))).toEqual(
      mac,
    );
    const defs = coordinatorToolDefs({ ownComputer: true, desktopTools: true });
    for (const name of mac)
      expect(defs.find((def) => def.name === name)?.description).toMatch(
        /^The user's own Mac, not your VM computer/,
      );
    for (const name of ['computer_observe', 'computer_act'])
      expect(defs.find((def) => def.name === name)?.description).toMatch(
        /^Your VM computer, not the user's Mac/,
      );
  });

  test('the Coordinator shell is offered with a VM computer, runs there, and is not the Mac shell', () => {
    expect(computerNames(true, false)).not.toContain('shell');
    expect(computerNames(true, true)).toContain('shell');
    const defs = coordinatorToolDefs({ desktopTools: true, vmComputer: true, ownComputer: true });
    expect(defs.find((def) => def.name === 'shell')?.description).toMatch(
      /^Your VM computer, not the user's Mac/,
    );
    expect(defs.find((def) => def.name === 'user_computer_shell')?.description).toMatch(
      /^The user's own Mac/,
    );
  });

  test('install_packages is offered only with a VM computer', () => {
    expect(computerNames(true, false)).not.toContain('install_packages');
    expect(computerNames(true, true)).toContain('install_packages');
    expect(computerNames(true, true)).not.toContain('computer_manage');
  });

  test('every offered computer tool is routed to a machine computer', () => {
    const unrouted = COMPUTER_TOOLS.filter(
      (name) =>
        'offered' in COORDINATOR_COMPUTER_TOOL_OFFERS[name] && !isCoordinatorComputerTool(name),
    );
    expect(unrouted).toEqual([]);
  });

  test('without a computer the desktop tools are not offered', () => {
    const always = COMPUTER_TOOLS.filter((name) => {
      const offer = COORDINATOR_COMPUTER_TOOL_OFFERS[name];
      return 'offered' in offer && offer.offered === 'always';
    }).sort();
    expect(computerNames(false)).toEqual(always);
    expect(always).not.toContain('computer_observe');
    expect(COMPUTER_DESKTOP_TOOLS.map((def) => def.name).sort()).toEqual([
      'computer_act',
      'computer_observe',
      'desktop_act',
      'desktop_snapshot',
    ]);
  });
});
