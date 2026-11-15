import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli.js';
import { type DoctorEnv, formatDoctor, runDoctor, runDoctorCommand } from '../src/doctor.js';

const GIB = 1024 ** 3;
const ALL_TOOLS = ['systemd-nspawn', 'machinectl', 'nft', 'ip', 'nmcli', 'sudo'];

interface Overrides {
  platform?: string;
  uid?: number;
  username?: string;
  nodeVersion?: string;
  files?: Record<string, string | undefined>;
  missing?: string[];
  fsType?: string;
  free?: number;
  osRelease?: string;
}

function fakeEnv(o: Overrides = {}): DoctorEnv {
  const files: Record<string, string | undefined> = {
    '/proc/1/comm': 'systemd\n',
    '/proc/sys/fs/protected_hardlinks': '1\n',
    '/etc/os-release': o.osRelease ?? 'ID=arch\n',
    ...o.files,
  };
  return {
    platform: o.platform ?? 'linux',
    uid: o.uid ?? 1000,
    username: o.username ?? 'ian',
    nodeVersion: o.nodeVersion ?? '24.14.0',
    readFile: (path) => files[path],
    which: (cmd) => !(o.missing ?? []).includes(cmd),
    run: (cmd) =>
      cmd === 'systemctl'
        ? { status: 0, stdout: 'systemd 262 (262-1-arch)\n+PAM +AUDIT\n' }
        : { status: 0, stdout: '7.2.0-arch1-1\n' },
    statfsType: () => o.fsType ?? 'btrfs',
    freeBytes: () => o.free ?? 100 * GIB,
  };
}

function check(env: DoctorEnv, id: string) {
  const found = runDoctor(env).checks.find((c) => c.id === id);
  if (!found) throw new Error(`missing check ${id}`);
  return found;
}

describe('runDoctor', () => {
  it('stops after the linux check on other platforms', () => {
    const result = runDoctor(fakeEnv({ platform: 'darwin' }));
    expect(result.ok).toBe(false);
    expect(result.checks).toEqual([
      {
        id: 'linux',
        label: 'Linux host',
        status: 'fail',
        detail: 'The Coordinator computer needs a Linux host; this machine can still run tasks',
      },
    ]);
  });

  it('passes every required check on a ready Arch host and reports versions', () => {
    const result = runDoctor(fakeEnv());
    expect(result.ok).toBe(true);
    expect(result.checks.filter((c) => c.status === 'fail')).toEqual([]);
    expect(check(fakeEnv(), 'btrfs').status).toBe('pass');
    expect(check(fakeEnv(), 'disk').status).toBe('pass');
    const versions = check(fakeEnv(), 'versions');
    expect(versions.status).toBe('info');
    expect(versions.detail).toContain('systemd 262, kernel 7.2.0-arch1-1');
    expect(versions.detail).toContain('known to work: systemd 262, kernel 7.2');
  });

  it('fails when pid 1 is not systemd', () => {
    const env = fakeEnv({ files: { '/proc/1/comm': 'init\n' } });
    expect(check(env, 'systemd-pid1').status).toBe('fail');
    expect(runDoctor(env).ok).toBe(false);
  });

  const distros: Array<[string, string, Record<string, string>]> = [
    [
      'arch',
      'ID=arch\n',
      {
        'systemd-nspawn': 'sudo pacman -S --needed systemd',
        machinectl: 'sudo pacman -S --needed systemd',
        nft: 'sudo pacman -S --needed nftables',
        ip: 'sudo pacman -S --needed iproute2',
        nmcli: 'sudo pacman -S --needed networkmanager',
        sudo: 'sudo pacman -S --needed sudo',
      },
    ],
    [
      'debian',
      'ID=ubuntu\nID_LIKE=debian\n',
      {
        'systemd-nspawn': 'sudo apt install systemd-container',
        machinectl: 'sudo apt install systemd-container',
        nft: 'sudo apt install nftables',
        ip: 'sudo apt install iproute2',
        nmcli: 'sudo apt install network-manager',
        sudo: 'sudo apt install sudo',
      },
    ],
    [
      'fedora',
      'ID=fedora\n',
      {
        'systemd-nspawn': 'sudo dnf install systemd-container',
        machinectl: 'sudo dnf install systemd-container',
        nft: 'sudo dnf install nftables',
        ip: 'sudo dnf install iproute',
        nmcli: 'sudo dnf install NetworkManager',
        sudo: 'sudo dnf install sudo',
      },
    ],
    [
      'unknown',
      'ID=gentoo\n',
      Object.fromEntries(ALL_TOOLS.map((t) => [t, `install the package that provides ${t}`])),
    ],
  ];

  for (const [name, osRelease, fixes] of distros) {
    it(`gives ${name} install fixes for each missing tool`, () => {
      for (const tool of ALL_TOOLS) {
        const env = fakeEnv({ osRelease, missing: [tool] });
        const c = check(env, `tool:${tool}`);
        expect(c.status).toBe('fail');
        expect(c.fix).toBe(fixes[tool]);
        expect(runDoctor(env).ok).toBe(false);
      }
    });
  }

  it('treats rhel-like hosts as dnf hosts', () => {
    const env = fakeEnv({
      osRelease: 'ID=rocky\nID_LIKE="rhel centos fedora"\n',
      missing: ['nft'],
    });
    expect(check(env, 'tool:nft').fix).toBe('sudo dnf install nftables');
  });

  it('requires Node 22.19 or newer', () => {
    const old = check(fakeEnv({ nodeVersion: '22.18.0' }), 'node');
    expect(old.status).toBe('fail');
    expect(old.fix).toBe('install Node 22.19 or newer');
    expect(check(fakeEnv({ nodeVersion: '22.19.0' }), 'node').status).toBe('pass');
  });

  it('fails when run as root', () => {
    const c = check(fakeEnv({ uid: 0 }), 'not-root');
    expect(c.status).toBe('fail');
    expect(c.fix).toBe('run cairn doctor as the account that will own the computer, without sudo');
  });

  it('fails when protected_hardlinks is off', () => {
    const env = fakeEnv({ files: { '/proc/sys/fs/protected_hardlinks': '0\n' } });
    const c = check(env, 'protected-hardlinks');
    expect(c.status).toBe('fail');
    expect(c.fix).toContain('sudo sysctl -w fs.protected_hardlinks=1');
    expect(c.fix).toContain('/etc/sysctl.d');
  });

  it('warns on a non-btrfs filesystem without failing', () => {
    const env = fakeEnv({ fsType: 'ext4' });
    const c = check(env, 'btrfs');
    expect(c.status).toBe('warn');
    expect(c.detail).toBe(
      'not btrfs: images are plain directories and rebuilds copy the whole tree',
    );
    expect(runDoctor(env).ok).toBe(true);
  });

  it('warns on low disk space and notes the image size', () => {
    const env = fakeEnv({ free: 4 * GIB });
    const c = check(env, 'disk');
    expect(c.status).toBe('warn');
    expect(c.detail).toContain('4.0 GiB');
    expect(c.detail).toContain('the base image is about 2 GiB');
    expect(runDoctor(env).ok).toBe(true);
  });

  describe('install state', () => {
    it('is info when not installed', () => {
      const c = check(fakeEnv(), 'install');
      expect(c.status).toBe('info');
      expect(c.detail).toBe('not installed yet');
      expect(c.fix).toBe('sudo bash scripts/ops/orb/install-host.sh');
    });

    it('passes when the owner matches the current user', () => {
      const env = fakeEnv({ files: { '/etc/cairn-orb/owner': 'ian\n' } });
      const c = check(env, 'install');
      expect(c.status).toBe('pass');
      expect(c.detail).toBe('installed for ian');
    });

    it('fails when the owner is another user', () => {
      const env = fakeEnv({ files: { '/etc/cairn-orb/owner': 'alice\n' } });
      const c = check(env, 'install');
      expect(c.status).toBe('fail');
      expect(c.detail).toBe('installed for alice; run as alice');
      expect(runDoctor(env).ok).toBe(false);
    });

    it('fails on an invalid owner file', () => {
      const env = fakeEnv({ files: { '/etc/cairn-orb/owner': 'Bad Owner!\n' } });
      const c = check(env, 'install');
      expect(c.status).toBe('fail');
      expect(c.detail).toBe('invalid owner file');
    });
  });
});

describe('doctor output', () => {
  it('renders marks, fix lines and the summary', () => {
    const result = runDoctor(fakeEnv({ missing: ['nft'], fsType: 'ext4' }));
    const text = formatDoctor(result);
    expect(text).toMatch(/^✓ /m);
    expect(text).toMatch(/^✗ .*nft/m);
    expect(text).toMatch(/^! /m);
    expect(text).toMatch(/^· /m);
    expect(text).toContain('Fix: sudo pacman -S --needed nftables');
    expect(text.trimEnd().split('\n').at(-1)).toBe('1 problem(s) found.');
  });

  it('prints the all-clear line when nothing fails', () => {
    const text = formatDoctor(runDoctor(fakeEnv()));
    expect(text.trimEnd().split('\n').at(-1)).toBe('All required checks passed.');
  });

  it('sets the exit code from the result and prints parseable JSON', () => {
    let out = '';
    const code = runDoctorCommand(
      { json: true },
      { env: fakeEnv({ uid: 0 }), writeOut: (t) => (out += t) },
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(out) as { ok: boolean; checks: Array<{ id: string }> };
    expect(parsed.ok).toBe(false);
    expect(parsed.checks.map((c) => c.id)).toContain('not-root');
  });

  it('registers the doctor command with a --json option', () => {
    const doctor = buildProgram().commands.find((c) => c.name() === 'doctor');
    expect(doctor?.description()).toBe(
      'Check whether this machine can host the Coordinator computer',
    );
    expect(doctor?.options.map((o) => o.long)).toContain('--json');
  });
});
