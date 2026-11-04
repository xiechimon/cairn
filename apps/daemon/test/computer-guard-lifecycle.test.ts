import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { protectedComputerLifecycleRefusal } from '../src/computer/guard.js';

describe('host lifecycle guard syntax and actions', () => {
  test('Bash expands the hidden kill command before execution', () => {
    expect(execFileSync('bash', ['-c', "printf '%s\\n' k{il,il}l 123"], { encoding: 'utf8' })).toBe(
      'kill\nkill\n123\n',
    );
  });

  test.each([
    'k{il,il}l 123',
    '/bin/k{il,il}l 123',
    '{ki,ki}ll 123',
    'p{k,k}ill chromium',
    "bash -c 'k{il,il}l 123'",
    'systemctl {suspend,hibernate}',
    'echo file{1..3}',
  ])('refuses unquoted brace syntax: %s', (command) => {
    expect(protectedComputerLifecycleRefusal(command)).toBe('brace expansion');
  });

  test.each([
    "printf '%s' 'k{il,il}l'",
    'printf "%s" "k{il,il}l"',
    'printf %s k\\{il,il\\}l',
    '{ echo ok; }',
    'printf %s {}',
    `printf %s "\${HOME}"`,
    'cat > notes.md <<\'EOF\'\n{"ok":true}\nEOF',
  ])('retains literal braces and standalone groups: %s', (command) => {
    expect(protectedComputerLifecycleRefusal(command)).toBeUndefined();
  });

  test.each([
    'default',
    'rescue',
    'emergency',
    'halt',
    'poweroff',
    'reboot',
    'kexec',
    'soft-reboot',
    'exit',
    'switch-root',
    'sleep',
    'suspend',
    'hibernate',
    'hybrid-sleep',
    'suspend-then-hibernate',
    'isolate',
    'daemon-reexec',
  ])('refuses the systemctl host lifecycle action %s at every inspected entry', (action) => {
    for (const command of [
      `systemctl ${action}`,
      `sudo /usr/bin/systemctl --user ${action}`,
      `bash -c 'systemctl ${action}'`,
    ]) {
      expect(protectedComputerLifecycleRefusal(command), command).toBe('host power command');
    }
    expect(
      protectedComputerLifecycleRefusal(`cat > script <<'EOF'\nsystemctl ${action}\nEOF`),
    ).toBe('heredoc');
  });

  test.each(['systemctl status', 'systemctl list-units', 'systemctl is-system-running'])(
    'retains read-only systemctl inspection: %s',
    (command) => {
      expect(protectedComputerLifecycleRefusal(command)).toBeUndefined();
      expect(
        protectedComputerLifecycleRefusal(`cat > notes <<'EOF'\n${command}\nEOF`),
      ).toBeUndefined();
    },
  );
});

const lifecycleUnits = [
  ...[
    'halt',
    'poweroff',
    'reboot',
    'kexec',
    'soft-reboot',
    'exit',
    'sleep',
    'suspend',
    'hibernate',
    'hybrid-sleep',
    'suspend-then-hibernate',
    'shutdown',
    'rescue',
    'emergency',
    'ctrl-alt-del',
  ].map((name) => `${name}.target`),
  ...[
    'systemd-halt',
    'systemd-poweroff',
    'systemd-reboot',
    'systemd-kexec',
    'systemd-soft-reboot',
    'systemd-exit',
    'systemd-suspend',
    'systemd-hibernate',
    'systemd-hybrid-sleep',
    'systemd-suspend-then-hibernate',
    'rescue',
    'emergency',
  ].flatMap((name) => [name, `${name}.service`]),
];

describe('host lifecycle unit boundary', () => {
  test.each(lifecycleUnits)('refuses changes to %s across inspected entry points', (unit) => {
    for (const command of [
      `systemctl start ${unit}`,
      `sudo /usr/bin/systemctl --user start /usr/lib/systemd/system/${unit}`,
      `systemctl enable --now ${unit}`,
      `systemctl try-reload-or-restart ${unit}`,
      `systemctl mask ${unit}`,
      `service ${unit} start`,
      `bash -c 'systemctl start ${unit}'`,
    ]) {
      expect(protectedComputerLifecycleRefusal(command), command).toBe('host power command');
    }
    expect(
      protectedComputerLifecycleRefusal(`cat > script <<'EOF'\nsystemctl start ${unit}\nEOF`),
    ).toBe('heredoc');
  });

  test.each(lifecycleUnits)('retains proven read-only inspection of %s', (unit) => {
    for (const verb of ['status', 'show', 'cat', 'help', 'is-active', 'is-failed', 'is-enabled']) {
      for (const command of [
        `systemctl ${verb} ${unit}`,
        `/usr/bin/systemctl --user --no-pager ${verb} /usr/lib/systemd/system/${unit}`,
        `bash -c 'systemctl ${verb} ${unit}'`,
      ]) {
        expect(protectedComputerLifecycleRefusal(command), command).toBeUndefined();
      }
      expect(
        protectedComputerLifecycleRefusal(`cat > notes <<'EOF'\nsystemctl ${verb} ${unit}\nEOF`),
      ).toBeUndefined();
    }
  });

  test.each([
    'systemctl start "rebo*.target"',
    'systemctl start "[rp]*.target"',
    'systemctl start "systemd-suspend*"',
    'systemctl --machine status start reboot.target',
    'systemctl --machine=status start reboot.target',
    'systemctl --host status start reboot.target',
    'systemctl --root status start reboot.target',
    'systemctl --root=/alternate start reboot.target',
    'systemctl status reboot.target; systemctl start reboot.target',
    'systemctl start reboot.target; systemctl status reboot.target',
    'systemctl status harmless.service && systemctl enable --now poweroff.target',
    'systemctl unknown-operation reboot.target',
  ])('fails closed on lifecycle patterns, mixed commands and ambiguous options: %s', (command) => {
    expect(protectedComputerLifecycleRefusal(command)).toBe('host power command');
  });

  test.each([
    'systemctl --property ActiveState show reboot.target',
    'systemctl --property=ActiveState show reboot.target',
    'systemctl -p ActiveState show reboot.target',
    'systemctl --type target list-units reboot.target',
    'systemctl -- status reboot.target',
    'systemctl list-dependencies poweroff.target',
    'systemctl start postgresql.service',
    'systemctl enable --now postgresql.service',
    'service postgresql start',
  ])('retains known read-only options and unrelated service activation: %s', (command) => {
    expect(protectedComputerLifecycleRefusal(command)).toBeUndefined();
  });
});
