import { describe, expect, test } from 'vitest';
import {
  desktopProtectionGuardMessage,
  protectedComputerLifecycleRefusal,
} from '../src/computer/guard.js';

const REFUSED = [
  'systemctl --user stop cairn-daemon',
  'systemctl --user restart cairn-daemon.service',
  'sudo systemctl restart cairn-server',
  'sudo systemctl disable --now cairn-daemon',
  'systemctl --user mask cairn-daemon',
  'sudo systemctl stop systemd-nspawn@cairn-orb-task-a.service',
  'sudo systemctl restart cairn-orb-egress-relay',
  'sudo systemctl stop cairn-orb-firewall.service',
  'service cairn-server restart',
  'machinectl poweroff cairn-orb-computer-x',
  'sudo machinectl terminate cairn-orb-task-a',
  'machinectl stop cairn-orb-base',
  'machinectl remove cairn-orb-computer',
  'machinectl reboot cairn-orb-task-a',
  'pkill -f cairn',
  'pkill cairn-daemon',
  'killall node',
  'kill $(pgrep -f cairn-daemon)',
  'kill -9 1234',
  'echo ok; kill 1234',
  'bash -c "pkill -f cairn"',
  "bash -lc 'sudo systemctl stop cairn-server'",
  'sudo sh -c "machinectl poweroff cairn-orb-x"',
  'sudo nft flush ruleset',
  'sudo nft delete table inet cairn_orb',
  'sudo ufw disable',
  'sudo iptables -F',
  'sudo shutdown -h now',
  'sudo reboot',
  'sudo poweroff',
  'sudo systemctl poweroff',
  'systemctl reboot',
  'cat <<EOF | bash\nsystemctl stop cairn-daemon\nEOF',
  'cat <<EOF\nhello\nEOF\nbash script.sh',
  'cat <<"EOF"\nsystemctl stop cairn-daemon\nEOF',
  'sy""stemctl stop cairn-daemon',
  "'systemctl' 'stop' 'cairn-daemon'",
  'ls; systemctl --user stop cairn-daemon && echo done',
  'p=pkill; $p -f cairn',
];

const ALLOWED = [
  'systemctl status cairn-daemon',
  'systemctl --user status cairn-daemon',
  'systemctl is-active cairn-server',
  'systemctl list-units "cairn-*"',
  'journalctl -u cairn-daemon --since today',
  'journalctl --user -u cairn-daemon -n 50',
  'machinectl list',
  'machinectl status cairn-orb-computer',
  'ls ~/.cairn && cat ~/.cairn/config.json',
  'echo "systemctl stop cairn-daemon"',
  "echo 'machinectl poweroff cairn-orb-x'",
  'grep -r cairn ~/Code | head',
  'sudo nft list ruleset',
  'sudo iptables -L',
  'git status',
  'sleep 5 && echo done',
];

describe('host computer guard: cairn protected targets', () => {
  test.each(REFUSED)('refuses %j', (command) => {
    expect(protectedComputerLifecycleRefusal(command)).toBeTypeOf('string');
  });

  test.each(ALLOWED)('allows %j', (command) => {
    expect(protectedComputerLifecycleRefusal(command)).toBeUndefined();
  });

  test('names cairn units in the reason for a unit stop', () => {
    expect(protectedComputerLifecycleRefusal('systemctl --user stop cairn-daemon')).toBe(
      'cairn daemon, server or Orb unit',
    );
    expect(protectedComputerLifecycleRefusal('machinectl poweroff cairn-orb-x')).toBe(
      'cairn Orb machine',
    );
  });

  test('the refusal message tells the bot nothing ran and that shell access remains', () => {
    const message = desktopProtectionGuardMessage('cairn Orb machine');
    expect(message).toContain('This command was not run');
    expect(message).toContain('Shell access is still available');
    expect(message).toContain('cairn');
  });
});
