import { COMPUTER_DESKTOP_TOOLS, COMPUTER_TOOLS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  COORDINATOR_COMPUTER_TOOL_OFFERS,
  coordinatorToolDefs,
} from '../src/services/coordinator-tool-defs.js';
import { isCoordinatorComputerTool } from '../src/services/machine-relay.js';

const computerNames = (
  desktopTools: boolean,
  ownComputer = desktopTools,
  phoneComputer: readonly string[] = [],
) =>
  coordinatorToolDefs({
    desktopTools,
    ownComputer,
    phoneComputer,
    browser: desktopTools,
    takeover: desktopTools,
  })
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
    expect(computerNames(true, true, ['Pixel 8a'])).toEqual(offered);
  });

  test("the user's Mac tools are offered only when the user's Mac is, and keep the Mac prefix", () => {
    expect(computerNames(true, false)).not.toContain('user_computer_observe');
    const mac = ['user_computer_act', 'user_computer_observe', 'user_computer_shell'];
    expect(computerNames(false, true).filter((name) => name.startsWith('user_'))).toEqual(mac);
    const defs = coordinatorToolDefs({ ownComputer: true, desktopTools: true });
    for (const name of mac)
      expect(defs.find((def) => def.name === name)?.description).toMatch(
        /^The user's own Mac, not the Coordinator computer desktop/,
      );
    for (const name of ['computer_observe', 'computer_act'])
      expect(defs.find((def) => def.name === name)?.description).toMatch(
        /^The Coordinator computer desktop, not the user's own screen/,
      );
  });

  test('the Coordinator VM command channel (shell, install_packages, computer_manage) is withheld', () => {
    expect('withheld' in COORDINATOR_COMPUTER_TOOL_OFFERS.shell).toBe(true);
    expect('withheld' in COORDINATOR_COMPUTER_TOOL_OFFERS.stage_attachment).toBe(true);
    expect(COORDINATOR_COMPUTER_TOOL_OFFERS.attach_file).toEqual({
      offered: 'when_owner_thread_and_team_has_mac',
    });
    expect(isCoordinatorComputerTool('shell')).toBe(false);
    expect(isCoordinatorComputerTool('install_packages')).toBe(false);
    expect(isCoordinatorComputerTool('attach_file')).toBe(true);
    expect(computerNames(true, true)).not.toContain('shell');
    expect(computerNames(true, true)).not.toContain('install_packages');
    expect(computerNames(true, true)).not.toContain('computer_manage');
    expect(computerNames(false, true)).toContain('attach_file');
    expect(computerNames(true, false)).not.toContain('attach_file');
  });

  test('browser tools are offered only when some machine can run a browser', () => {
    const names = coordinatorToolDefs({ browser: false, takeover: false }).map((def) => def.name);
    expect(names.filter((name) => name.startsWith('browser_'))).toEqual([]);
    expect(names).not.toContain('request_takeover');
  });

  test('when nobody can take over, the browser tools say so and never name request_takeover', () => {
    const defs = coordinatorToolDefs({ takeover: false });
    expect(defs.map((def) => def.name)).not.toContain('request_takeover');
    for (const def of defs.filter((def) => def.name.startsWith('browser_'))) {
      expect(def.description).not.toContain('request_takeover');
      expect(def.description).toContain('Nobody can watch or take over this browser');
    }
  });

  test('with no stealth browser in the team, nothing offers or mentions one', () => {
    const defs = coordinatorToolDefs({ stealth: false, ownerChrome: true }).filter((def) =>
      def.name.startsWith('browser_'),
    );
    expect(defs.map((def) => def.name).sort()).toEqual([
      'browser_act',
      'browser_navigate',
      'browser_snapshot',
    ]);
    expect(JSON.stringify(defs)).not.toMatch(/stealth/i);
  });

  test('every offered computer tool is routed to a machine computer', () => {
    const unrouted = COMPUTER_TOOLS.filter(
      (name) =>
        'offered' in COORDINATOR_COMPUTER_TOOL_OFFERS[name] && !isCoordinatorComputerTool(name),
    );
    expect(unrouted).toEqual([]);
  });

  test('without a computer the desktop and browser tools are not offered', () => {
    expect(computerNames(false)).toEqual([]);
    expect(COMPUTER_DESKTOP_TOOLS.map((def) => def.name).sort()).toEqual([
      'computer_act',
      'computer_observe',
      'desktop_act',
      'desktop_snapshot',
    ]);
  });
});
