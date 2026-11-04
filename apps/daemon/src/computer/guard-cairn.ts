import { matchesGlob } from 'node:path';

const SYSTEMCTL_NAMES = /^(?:systemctl|service)$/;
const LIFECYCLE_UNITS = [
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
const READ_ONLY_SYSTEMCTL_ACTIONS =
  /^(?:status|show|cat|help|is-active|is-failed|is-enabled|list-dependencies|list-unit-files|list-units)$/;
const READ_ONLY_SYSTEMCTL_FLAGS =
  /^(?:--(?:user|system|no-pager|no-legend|full|all|plain|quiet|value|recursive|reverse|with-dependencies|failed|no-ask-password)|-[alqr])$/;
const READ_ONLY_SYSTEMCTL_VALUE_FLAGS = /^(?:--(?:property|type|state|output|lines)|-[pPton])$/;
const READ_ONLY_SYSTEMCTL_VALUE_OPTIONS = /^--(?:property|type|state|output|lines)=/;
const UNIT_MUTATIONS =
  /^(?:stop|restart|kill|try-restart|reload|reload-or-restart|try-reload-or-restart|disable|mask|revert|edit|set-property|freeze|clean)$/;
const HOST_POWER_ACTIONS =
  /^(?:default|rescue|emergency|poweroff|reboot|halt|kexec|soft-reboot|exit|switch-root|sleep|suspend|hibernate|hybrid-sleep|suspend-then-hibernate|isolate|daemon-reexec)$/;
const HOST_POWER_COMMANDS = /^(?:shutdown|reboot|poweroff|halt)$/;
const MACHINECTL_MUTATIONS =
  /^(?:poweroff|terminate|stop|reboot|kill|remove|disable|clean|rename|reset|set-limit|clone)$/;
const CAIRN_TARGET = /cairn|systemd-nspawn/i;
const FIREWALL_NAMES = /^(?:nft|ufw|iptables|ip6tables|iptables-nft|ip6tables-nft)$/;
const FIREWALL_MUTATIONS =
  /^(?:flush|delete|destroy|disable|reset|reload|-F|--flush|-X|--delete-chain|-D|--delete|-P|--policy)$/;

function basename(word: string): string {
  return (word.split('/').at(-1) ?? '').toLowerCase();
}

function isLifecycleUnit(word: string): boolean {
  const pattern = basename(word);
  return LIFECYCLE_UNITS.some((unit) => matchesGlob(unit, pattern));
}

function isReadOnlySystemctl(words: readonly string[], managerIndex: number): boolean {
  if (basename(words[managerIndex] ?? '') !== 'systemctl') return false;
  for (let index = managerIndex + 1; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (word === '--') return READ_ONLY_SYSTEMCTL_ACTIONS.test(words[index + 1] ?? '');
    if (READ_ONLY_SYSTEMCTL_FLAGS.test(word) || READ_ONLY_SYSTEMCTL_VALUE_OPTIONS.test(word)) {
      continue;
    }
    if (READ_ONLY_SYSTEMCTL_VALUE_FLAGS.test(word)) {
      if (words[index + 1] === undefined) return false;
      index += 1;
      continue;
    }
    return READ_ONLY_SYSTEMCTL_ACTIONS.test(word);
  }
  return false;
}

export function cairnHostRefusal(words: readonly string[]): string | undefined {
  const names = words.map(basename);
  const arguments_ = words.map((word) => word.toLowerCase());
  const targetsCairn = words.some((word) => CAIRN_TARGET.test(word));
  if (
    names.includes('machinectl') &&
    targetsCairn &&
    arguments_.some((word) => MACHINECTL_MUTATIONS.test(word))
  ) {
    return 'cairn Orb machine';
  }
  if (names.some((name) => HOST_POWER_COMMANDS.test(name))) return 'host power command';
  const managers = names.flatMap((name, index) => (SYSTEMCTL_NAMES.test(name) ? [index] : []));
  if (managers.length > 0) {
    const lifecycle = words.some(isLifecycleUnit);
    if (lifecycle && managers.some((index) => !isReadOnlySystemctl(words, index))) {
      return 'host power command';
    }
    if (!lifecycle && arguments_.some((word) => HOST_POWER_ACTIONS.test(word))) {
      return 'host power command';
    }
    if (targetsCairn && arguments_.some((word) => UNIT_MUTATIONS.test(word))) {
      return 'cairn daemon, server or Orb unit';
    }
  }
  if (
    names.some((name) => FIREWALL_NAMES.test(name)) &&
    words.some((word) => FIREWALL_MUTATIONS.test(word))
  ) {
    return 'firewall change';
  }
  return undefined;
}
