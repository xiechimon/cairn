import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { changes } from './host-files.mjs';
import { missingUfwRules } from './ufw-rules.mjs';

export function installHost(options = {}) {
  const {
    root = '/',
    dryRun = false,
    log = console.log,
    nodeBinary = readFileSync(process.execPath),
  } = options;
  const change = changes(options);
  for (const [cmd, args] of [
    [process.execPath, ['--version']],
    ['nft', ['--version']],
    ['ip', ['-Version']],
    ['nmcli', ['--version']],
  ]) {
    if (change.probe(cmd, args).status !== 0)
      throw new Error(`Required host tool unavailable: ${cmd}`);
  }
  for (const directory of [
    '/etc/systemd/network',
    '/run/systemd/network',
    '/usr/lib/systemd/network',
    '/usr/local/lib/systemd/network',
  ]) {
    const path = join(root, directory);
    if (!existsSync(path)) continue;
    const earlier = readdirSync(path).find(
      (name) => name.endsWith('.network') && name < '00-cairn-unmanaged.network',
    );
    if (earlier)
      throw new Error(`Preserve earlier networkd configuration: ${directory}/${earlier}`);
  }
  if (change.probe('systemctl', ['is-active', 'systemd-networkd.service']).status === 0) {
    const links = change.probe('networkctl', ['--no-legend', '--no-pager', '--full', 'list']);
    if (links.status !== 0 || !links.stdout?.trim())
      throw new Error('Cannot inspect existing networkd links');
    for (const line of links.stdout.trim().split('\n')) {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 5 || !/^\d+$/.test(fields[0]))
        throw new Error('Cannot parse existing networkd links');
      const name = fields[1];
      if (name !== 'lo' && !/^(ve-|vz-|vb-)/.test(name) && fields[4] !== 'unmanaged')
        throw new Error(`Preserve existing networkd-managed link: ${name}`);
    }
  }
  const assets = [
    ['50-cairn-orb.rules', '/etc/polkit-1/rules.d/50-cairn-orb.rules'],
    ['cairn-orb.nspawn', '/etc/systemd/nspawn/cairn-orb.nspawn'],
    [
      'systemd-nspawn@cairn-orb-.service.d/limits.conf',
      '/etc/systemd/system/systemd-nspawn@cairn-orb-.service.d/limits.conf',
    ],
    ['prepare-machine.sh', '/usr/local/lib/cairn-orb/prepare-machine.sh', 0o755],
    ['runtime-directory.mjs', '/usr/local/lib/cairn-orb/runtime-directory.mjs'],
    ['egress-relay.mjs', '/usr/local/lib/cairn-orb/egress-relay.mjs'],
    ['firewall.nft', '/etc/cairn-orb/firewall.nft'],
    ['cairn-orb-firewall.service', '/etc/systemd/system/cairn-orb-firewall.service'],
    ['egress-relay.sh', '/usr/local/lib/cairn-orb/egress-relay.sh', 0o755],
    ['egress-relay.service', '/etc/systemd/user/egress-relay.service'],
  ];
  if (change.probe('pacman', ['-Q', 'arch-install-scripts']).status !== 0) {
    change.exec('pacman', ['-S', '--needed', '--noconfirm', 'arch-install-scripts']);
  }
  const directories = [
    ['/run/cairn-orb', 'root', 'root'],
    ['/var/lib/cairn-orb', 'root', 'root'],
    ['/var/lib/cairn-orb/dist', 'ian', '-'],
    ['/var/lib/cairn-orb/seed', 'ian', '-'],
  ];
  const tmpfiles = `${directories.map(([path, owner, group]) => `d ${path} 0755 ${owner} ${group} -`).join('\n')}\n`;
  const foreignRules = [
    '/etc/systemd/networkd.conf.d/10-cairn-keep-foreign.conf',
    '[Network]\nManageForeignRoutingPolicyRules=no\nManageForeignRoutes=no\n',
  ];
  const foreignRulesChanged = !change.matches(...foreignRules);
  const files = [
    ['/etc/tmpfiles.d/cairn-orb.conf', tmpfiles],
    foreignRules,
    ['/usr/local/lib/cairn-orb/node', nodeBinary, 0o755],
    ...assets.map(([source, target, mode]) => [
      target,
      readFileSync(new URL(source, import.meta.url), 'utf8'),
      mode,
    ]),
    [
      '/etc/systemd/system/systemd-nspawn@.service.d/20-cairn-orb.conf',
      '[Unit]\nRequires=cairn-orb-firewall.service\nAfter=cairn-orb-firewall.service\n\n[Service]\nExecStartPre=+/usr/local/lib/cairn-orb/prepare-machine.sh %i\nExecStopPost=\nExecStopPost=+/usr/local/lib/cairn-orb/prepare-machine.sh --stop %i\nExecStopPost=-systemd-nspawn --cleanup --machine=%i\nEnvironment=CAIRN_ORB_BINDS=\nEnvironment="CAIRN_ORB_FIXED_BINDS=--bind=/run/cairn-orb/%i:/run/cairn:idmap,norbind --bind-ro=/var/lib/cairn-orb/dist:/opt/cairn/daemon:idmap,norbind --bind-ro=/var/lib/cairn-orb/seed:/seed:idmap,norbind"\nEnvironmentFile=-/run/systemd/nspawn/%i.binds\nExecStart=\nExecStart=systemd-nspawn --quiet --keep-unit --boot --link-journal=try-guest --network-veth -U --settings=override --machine=%i $CAIRN_ORB_BINDS\n',
    ],
    [
      '/etc/systemd/system/systemd-networkd.service.d/20-cairn-orb.conf',
      '[Unit]\nRequires=cairn-orb-firewall.service\nAfter=cairn-orb-firewall.service\n',
    ],
    [
      '/etc/NetworkManager/conf.d/90-cairn-orb.conf',
      '[keyfile]\nunmanaged-devices+=interface-name:ve-*;interface-name:vz-*;interface-name:vb-*\n',
    ],
    [
      '/etc/systemd/network/00-cairn-unmanaged.network',
      '[Match]\nName=!ve-* vz-* vb-*\n\n[Link]\nUnmanaged=yes\n',
    ],
    ['/etc/systemd/network/10-cairn.netdev', '[NetDev]\nName=vz-cairn\nKind=bridge\n'],
    [
      '/etc/systemd/network/10-cairn.network',
      '[Match]\nName=vz-cairn\n\n[Network]\nConfigureWithoutCarrier=yes\nAddress=10.203.0.1/24\nDHCPServer=yes\nIPMasquerade=no\nIPv4Forwarding=no\nIPv6Forwarding=no\nLinkLocalAddressing=no\nIPv6AcceptRA=no\n\n[DHCPServer]\nEmitRouter=no\nEmitDNS=no\n',
    ],
  ];
  const pending = join(root, 'var/lib/cairn-orb/install-pending');
  let previousPending = false;
  try {
    previousPending = readFileSync(pending, 'utf8') === 'pending\n';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const needsReload = previousPending || files.some((file) => !change.matches(...file));
  change.file(...files[0]);
  const inspectDirectories = () =>
    directories.map(([path, owner, group]) => {
      const result = change.probe('stat', [
        '-c',
        group === '-' ? '%F:%U:%a' : '%F:%U:%G:%a',
        join(root, path),
      ]);
      if (result.status === 0 && !result.stdout?.startsWith('directory:'))
        throw new Error(`Expected a bind directory without symlinks: ${path}`);
      const expected = group === '-' ? `directory:${owner}:755` : `directory:${owner}:${group}:755`;
      return result.status === 0 && result.stdout?.trim() === expected;
    });
  if (inspectDirectories().some((matches) => !matches)) {
    log(tmpfiles.trim());
    change.exec('systemd-tmpfiles', ['--create', '/etc/tmpfiles.d/cairn-orb.conf']);
    if (!dryRun && inspectDirectories().some((matches) => !matches))
      throw new Error('Bind directory ownership or mode did not converge');
  }
  if (needsReload) change.file('/var/lib/cairn-orb/install-pending', 'pending\n');
  for (const file of files) change.file(...file);
  if (needsReload) {
    change.exec('systemctl', ['daemon-reload']);
  }
  const firewall = readFileSync(new URL('firewall.nft', import.meta.url), 'utf8');
  const firewallPresent = change.probe('nft', ['list', 'table', 'inet', 'cairn_orb']).status === 0;
  if (
    needsReload ||
    !firewallPresent ||
    change.probe('systemctl', ['is-active', 'cairn-orb-firewall.service']).status !== 0
  ) {
    log(firewall.trim());
    change.exec('systemctl', [
      change.probe('systemctl', ['is-active', 'cairn-orb-firewall.service']).status === 0
        ? 'reload'
        : 'start',
      'cairn-orb-firewall.service',
    ]);
  }
  if (change.probe('systemctl', ['is-enabled', 'cairn-orb-firewall.service']).status !== 0)
    change.exec('systemctl', ['enable', 'cairn-orb-firewall.service']);
  if (change.probe('systemctl', ['is-active', 'ufw']).status === 0) {
    const rules = readFileSync(join(root, 'etc/ufw/user.rules'), 'utf8');
    for (const { args } of missingUfwRules(rules)) change.exec('ufw', args);
  }
  if (needsReload) {
    change.exec('nmcli', ['general', 'reload', 'conf']);
    if (change.probe('systemctl', ['is-active', 'systemd-networkd.service']).status === 0) {
      if (foreignRulesChanged) change.exec('systemctl', ['restart', 'systemd-networkd.service']);
      change.exec('networkctl', ['reload']);
    }
  }
  for (const [probe, action] of [
    ['is-enabled', 'enable'],
    ['is-active', 'start'],
  ]) {
    if (change.probe('systemctl', [probe, 'systemd-networkd.service']).status !== 0)
      change.exec('systemctl', [action, 'systemd-networkd.service']);
  }
  if (
    change.probe('loginctl', ['show-user', 'ian', '-p', 'Linger', '--value']).stdout?.trim() !==
    'yes'
  )
    change.exec('loginctl', ['enable-linger', 'ian']);
  const uid = change.probe('id', ['-u', 'ian']).stdout?.trim();
  if (!dryRun && !/^\d+$/.test(uid ?? '')) throw new Error('Cannot resolve ian uid');
  const userManager = `user@${uid || '<ian-uid>'}.service`;
  if (change.probe('systemctl', ['is-active', userManager]).status !== 0) {
    change.exec('systemctl', ['start', userManager]);
  }
  const userctl = [
    '-u',
    'ian',
    '--',
    'env',
    `XDG_RUNTIME_DIR=/run/user/${uid || '<ian-uid>'}`,
    'systemctl',
    '--user',
  ];
  if (needsReload) {
    change.exec('runuser', [...userctl, 'daemon-reload']);
    if (change.probe('runuser', [...userctl, 'is-active', 'egress-relay.service']).status === 0)
      change.exec('runuser', [...userctl, 'restart', 'egress-relay.service']);
  }
  for (const [probe, action] of [
    ['is-enabled', 'enable'],
    ['is-active', 'start'],
  ]) {
    if (change.probe('runuser', [...userctl, probe, 'egress-relay.service']).status !== 0)
      change.exec('runuser', [...userctl, action, 'egress-relay.service']);
  }
  if (dryRun) log('plan: bash build-image.sh --dry-run');
  const image = change.probe('bash', [
    resolve(import.meta.dirname, 'build-image.sh'),
    ...(dryRun ? ['--dry-run'] : []),
  ]);
  if (image.stderr?.trim()) log(image.stderr.trim());
  if (image.status !== 0) {
    if (image.stdout?.trim()) log(image.stdout.trim());
    throw new Error(`build-image failed: ${image.stderr || image.stdout}`);
  }
  const imageChanged = image.stdout?.trim() !== '0 changes';
  if (imageChanged) log(image.stdout?.trim());
  if (change.count > 0 || previousPending)
    change.file('/var/lib/cairn-orb/install-pending', 'complete\n');
  log(`${change.count + (imageChanged ? 1 : 0)}${dryRun ? ' planned' : ''} changes`);
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run'))
    throw new Error('Usage: install-host.sh [--dry-run]');
  const dryRun = args[0] === '--dry-run';
  if (!dryRun && process.getuid() !== 0) throw new Error('Run install-host.sh as root');
  installHost({ dryRun });
}
