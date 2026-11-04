import { describe, expect, test } from 'vitest';
import { protectedComputerLifecycleRefusal } from '../src/computer/guard.js';

const EXECUTABLE_PATTERNS = [
  'pk*ll',
  'pk?ll',
  'p[k]ill',
  '[p]kill',
  '[!x]kill',
  '/usr/bin/pk*ll',
  '/usr/bin/pk?ll',
  '/usr/bin/p[k]ill',
  '/usr/b?n/pkill',
];

const INVOCATIONS = [
  (executable: string) => `${executable} chromium`,
  (executable: string) => `command -- ${executable} chromium`,
  (executable: string) => `exec ${executable} chromium`,
  (executable: string) => `env LANG=C ${executable} chromium`,
  (executable: string) => `env -u DISPLAY ${executable} chromium`,
  (executable: string) => `sudo -u user -- ${executable} chromium`,
  (executable: string) => `nice -n 5 ${executable} chromium`,
  (executable: string) => `nohup ${executable} chromium`,
  (executable: string) => `stdbuf -oL ${executable} chromium`,
  (executable: string) => `true; ${executable} chromium`,
  (executable: string) => `true && ${executable} chromium`,
  (executable: string) => `bash -lc '${executable} chromium'`,
  (executable: string) => `cat <<EOF\n${executable} chromium\nEOF`,
  (executable: string) => `cat <<'EOF'\n${executable} chromium\nEOF`,
];

const ALLOWED = [
  'ls *.ts',
  'printf "%s\\n" /usr/bin/pk?ll',
  'grep text notes[0-9].txt',
  'env -u DISPLAY ls *.ts',
  'sudo -u user -- ls notes[0-9].txt',
  'nice -n 5 ls *.ts',
  'command -- ls /usr/bin/p[k]ill',
  'bash -c "ls *.ts"',
  "'/home/user/script?.sh' value",
  '"/home/user/script*.sh" value',
  '/home/user/script\\?.sh value',
  '/home/user/script\\[x\\].sh value',
  "env LANG=C '/home/user/script[0].sh' value",
  "cat <<'EOF'\n'/home/user/script?.sh' value\nEOF",
  'cat <<EOF\nls *.ts\nEOF',
  "cat <<'EOF'\nls *.ts\nEOF",
  'cat <<EOF\nenv -u DISPLAY ls *.ts\nEOF',
  'cat <<EOF\nsudo -u user -- ls notes[0-9].txt\nEOF',
  'cat <<EOF\nls > notes[0-9].txt\nEOF',
  'cat <<EOF\nls $HOME/*.ts\nEOF',
  'ls > notes[0-9].txt',
  'ls $HOME/*.ts',
  'command -- ls $HOME/*.ts',
];

const HEREDOC_EDGE_REFUSALS = [
  'cat <<EOF\ncommand -- pk*ll chromium\nEOF',
  'cat <<EOF\nenv -u DISPLAY pk*ll chromium\nEOF',
  'cat <<EOF\nsudo -u user -- pk*ll chromium\nEOF',
  'cat <<EOF\n$HOME/pk*ll chromium\nEOF',
  'cat <<EOF\npk*ll chromium > notes[0-9].txt\nEOF',
  'pk*ll chromium > notes[0-9].txt',
  'command -- $HOME/pk*ll chromium',
];

describe('executable pathname pattern boundary', () => {
  test.each(EXECUTABLE_PATTERNS.flatMap((pattern) => INVOCATIONS.map((invoke) => invoke(pattern))))(
    'refuses executable expansion in %j',
    (command) => {
      expect(protectedComputerLifecycleRefusal(command)).toBeTypeOf('string');
    },
  );

  test.each(ALLOWED)('preserves arguments and literal executable filenames in %j', (command) => {
    expect(protectedComputerLifecycleRefusal(command)).toBeUndefined();
  });

  test.each(HEREDOC_EDGE_REFUSALS)(
    'refuses wrapper, expansion, and redirect executable patterns in %j',
    (command) => {
      expect(protectedComputerLifecycleRefusal(command)).toBe('executable pathname expansion');
    },
  );
});
