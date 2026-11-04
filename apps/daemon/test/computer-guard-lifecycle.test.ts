import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { createComputerDispatcher } from '../src/computer/dispatch.js';
import type { ComputerFrameBody } from '../src/computer/frame-poster.js';
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
    'runlevel0',
    'runlevel1',
    'runlevel6',
    'runlevelS',
    'final',
    'umount',
    'factory-reset',
    'factory-reset-now',
    'system-update',
    'system-update-pre',
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
    'systemd-factory-reset-request',
    'systemd-factory-reset-reboot',
    'systemd-factory-reset-complete',
    'system-update-cleanup',
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
    'systemctl start "runlevel*.target"',
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

  test.each(['*', 'x'])('fails closed on an overlength unit operand made of %s', (character) => {
    const command = `systemctl start "${character.repeat(70000)}"`;
    expect(protectedComputerLifecycleRefusal(command)).toBe('host power command');
  });

  test.each(['*', 'x'])(
    'preserves read-only inspection with an overlength %s operand',
    (character) => {
      expect(
        protectedComputerLifecycleRefusal(`systemctl status "${character.repeat(70000)}"`),
      ).toBeUndefined();
    },
  );

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
    'systemctl start runlevel2.target',
    'systemctl start runlevel3.target',
    'systemctl start runlevel4.target',
    'systemctl start runlevel5.target',
    'systemctl start sigpwr.target',
    'systemctl start kbrequest.target',
  ])('retains known read-only options and unrelated service activation: %s', (command) => {
    expect(protectedComputerLifecycleRefusal(command)).toBeUndefined();
  });
});

test.each(['direct', 'nested', 'heredoc'] as const)(
  'an overlength unit mutation produces one terminal refusal through %s inspection',
  async (mode) => {
    const mutation = `systemctl start "${'*'.repeat(70000)}"`;
    const command =
      mode === 'nested'
        ? `bash -c '${mutation}'`
        : mode === 'heredoc'
          ? `cat > script <<'EOF'\n${mutation}\nEOF`
          : mutation;
    let executed = 0;
    const frames: ComputerFrameBody[] = [];
    const dispatcher = createComputerDispatcher({
      host: {
        async execute() {
          executed += 1;
          return (async function* () {
            yield { kind: 'exit' as const, code: 0 };
          })();
        },
        async listFiles() {
          return [];
        },
        async readFile() {
          return '';
        },
        async writeFile() {},
        async killAll() {},
      },
      client: {
        async computerFrames(_callId, body) {
          frames.push(...body.frames);
          return { ok: true, cancelled: false };
        },
      },
    });
    try {
      await dispatcher.dispatch({
        callId: 'c'.repeat(64),
        stepId: 'step',
        tool: 'user_computer_shell',
        params: { command },
        deadlineAt: Date.now() + 60000,
      });
      expect(executed).toBe(0);
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    } finally {
      await dispatcher.close();
    }
  },
);
