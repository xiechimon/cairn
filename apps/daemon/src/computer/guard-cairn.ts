const SYSTEMCTL_NAMES = /^(?:systemctl|service)$/;
const UNIT_MUTATIONS =
  /^(?:stop|restart|kill|try-restart|reload|reload-or-restart|try-reload-or-restart|disable|mask|revert|edit|set-property|freeze|clean)$/;
const HOST_POWER_ACTIONS = /^(?:poweroff|reboot|halt|kexec|isolate|daemon-reexec)$/;
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
  if (names.some((name) => SYSTEMCTL_NAMES.test(name))) {
    if (arguments_.some((word) => HOST_POWER_ACTIONS.test(word))) return 'host power command';
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
