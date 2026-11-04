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
