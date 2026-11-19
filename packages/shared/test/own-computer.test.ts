import { describe, expect, test } from 'vitest';
import { ownComputerCallSummary, ownComputerHardlineRefusal } from '../src/index.js';

describe("the owner's Mac hardline list", () => {
  test.each([
    'rm -rf ~',
    'rm -rf ~/',
    'rm -rf ~/*',
    'rm -rf $HOME',
    'rm -rf "$HOME"',
    `rm -fr \${HOME}/`,
    'rm -rf /',
    'rm -rf /*',
    'sudo rm -rf --no-preserve-root /',
    '/bin/rm -r -f /Users/ian',
    'rm -rf /Users',
    'rm -rf /System',
    'rm -rf /Applications/',
    'cd /tmp && rm -rf ~',
    'echo hi; rm -rf /',
    'mkfs.ext4 /dev/sdb1',
    'newfs_apfs /dev/disk3',
    'diskutil eraseDisk APFS Empty disk2',
    'diskutil eraseVolume APFS X disk2s1',
    'diskutil secureErase 0 disk2',
    'diskutil partitionDisk disk2 GPT JHFS+ A 100%',
    'dd if=/dev/zero of=/dev/disk2 bs=1m',
    'sudo dd if=image.iso of=/dev/rdisk4',
    'cat image > /dev/rdisk4',
    ':(){ :|:& };:',
    'bomb(){ bomb|bomb& };bomb',
    'shutdown -h now',
    'sudo shutdown -r +1',
    'reboot',
    'sudo halt',
    'launchctl reboot',
    'csrutil disable',
    'csrutil clear',
  ])('refuses %j', (command) => {
    expect(ownComputerHardlineRefusal(command)).toMatch(/^This command was not run because /);
  });

  test.each([
    'rm -rf ~/Code/cairn/node_modules',
    'rm -rf ./build',
    'rm -rf /tmp/scratch',
    'rm -rf /Users/ian/Library/Caches/foo',
    'rm ~/notes.txt.bak',
    'ls /',
    'echo rm -rf ~ is dangerous',
    'grep -r shutdown src/',
    'git log --grep reboot',
    'diskutil list',
    'diskutil info disk2',
    'dd if=/dev/zero of=/tmp/blank bs=1m count=1',
    'dd if=/dev/urandom of=/dev/null count=1',
    'csrutil status',
    "python3 - <<'EOF'\nprint(1)\nEOF",
    'echo "$(date)" `whoami` && (cd /tmp && ls)',
    'xcodebuild -scheme Cairn build',
    'open -a "System Settings"',
  ])('runs %j', (command) => {
    expect(ownComputerHardlineRefusal(command)).toBeNull();
  });
});

describe('call summaries for the activity log', () => {
  test('a shell call shows its command, an act call its app and action kinds', () => {
    expect(ownComputerCallSummary('user_computer_shell', { command: 'xcodebuild' })).toBe(
      'xcodebuild',
    );
    expect(ownComputerCallSummary('user_computer_observe', { app: ' Finder ' })).toBe('Finder');
    expect(
      ownComputerCallSummary('user_computer_act', {
        app: 'Notes',
        actions: [{ kind: 'click', element: 2 }, { kind: 'type', text: 'secret' }, null],
      }),
    ).toBe('Notes: click, type');
  });
});
