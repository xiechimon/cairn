import { COMPUTER_DESKTOP_TOOLS, COMPUTER_TOOLS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  COORDINATOR_COMPUTER_TOOL_OFFERS,
  coordinatorToolDefs,
} from '../src/services/coordinator-tool-defs.js';

const computerNames = (desktopTools: boolean, vmComputer = desktopTools) =>
  coordinatorToolDefs({ desktopTools, vmComputer })
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

  test('install_packages is offered only with a VM computer', () => {
    expect(computerNames(true, false)).not.toContain('install_packages');
    expect(computerNames(true, true)).toContain('install_packages');
    expect(computerNames(true, true)).not.toContain('computer_manage');
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
    ]);
  });
});
