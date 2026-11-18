import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli.js';
import { type DoctorEnv, formatDoctor, runDoctor, runDoctorCommand } from '../src/doctor.js';

const GIB = 1024 ** 3;
const LINUX_TOOLS = ['systemd-run', 'bwrap'];

interface Overrides {
  platform?: string;
  uid?: number;
  username?: string;
  home?: string;
  nodeVersion?: string;
  files?: Record<string, string | undefined>;
  missing?: string[];
  free?: number;
  osRelease?: string;
  stdout?: Record<string, string>;
}

function fakeEnv(o: Overrides = {}): DoctorEnv {
  const files: Record<string, string | undefined> = {
    '/proc/1/comm': 'systemd\n',
    '/proc/sys/fs/protected_hardlinks': '1\n',
    '/proc/sys/user/max_user_namespaces': '28633\n',
    '/etc/os-release': o.osRelease ?? 'ID=arch\n',
    ...o.files,
  };
  return {
    platform: o.platform ?? 'linux',
    uid: o.uid ?? 1000,
    username: o.username ?? 'ian',
    home: o.home ?? '/home/ian',
    nodeVersion: o.nodeVersion ?? '24.14.0',
    readFile: (path) => files[path],
    which: (cmd) => !(o.missing ?? []).includes(cmd),
    run: (cmd) => ({ status: 0, stdout: o.stdout?.[cmd] ?? '' }),
    freeBytes: () => o.free ?? 100 * GIB,
  };
}

function linuxEnv(o: Overrides = {}): DoctorEnv {
  return fakeEnv({
    stdout: {
      systemctl: 'systemd 262 (262-1-arch)\n+PAM +AUDIT\n',
      uname: '7.2.0-arch1-1\n',
    },
    ...o,
  });
}

function check(env: DoctorEnv, id: string) {
  const found = runDoctor(env).checks.find((c) => c.id === id);
  if (!found) throw new Error(`missing check ${id}`);
  return found;
}

describe('runDoctor on macOS', () => {
  it('reports runner readiness instead of failing as a non-Linux host', () => {
    const result = runDoctor(fakeEnv({ platform: 'darwin' }));
    expect(result.ok).toBe(true);
    expect(check(fakeEnv({ platform: 'darwin' }), 'macos').status).toBe('pass');
    expect(result.checks.map((c) => c.id)).toEqual([
      'macos',
      'node',
      'not-root',
      'seatbelt',
      'vm-runtime',
      'disk',
      'versions',
    ]);
  });

  it('fails when sandbox-exec is missing', () => {
    const env = fakeEnv({ platform: 'darwin', missing: ['sandbox-exec'] });
    const c = check(env, 'seatbelt');
    expect(c.status).toBe('fail');
    expect(runDoctor(env).ok).toBe(false);
  });

  it('reports the VM runtime as optional info when container is absent', () => {
    const absent = check(fakeEnv({ platform: 'darwin', missing: ['container'] }), 'vm-runtime');
    expect(absent.status).toBe('info');
    expect(absent.detail).toContain('optional');
    expect(runDoctor(fakeEnv({ platform: 'darwin', missing: ['container'] })).ok).toBe(true);
    expect(check(fakeEnv({ platform: 'darwin' }), 'vm-runtime').status).toBe('pass');
  });
});

describe('runDoctor on Linux', () => {
  it('passes every required check on a ready host and reports versions', () => {
    const result = runDoctor(linuxEnv());
    expect(result.ok).toBe(true);
    expect(result.checks.filter((c) => c.status === 'fail')).toEqual([]);
    const versions = check(linuxEnv(), 'versions');
    expect(versions.status).toBe('info');
    expect(versions.detail).toContain('systemd 262, kernel 7.2.0-arch1-1');
    expect(versions.detail).toContain('known to work: systemd 262, kernel 7.2');
  });

  it('fails on unsupported platforms', () => {
    const result = runDoctor(fakeEnv({ platform: 'win32' }));
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ id: 'platform', status: 'fail' });
  });

  it('fails when pid 1 is not systemd', () => {
    const env = linuxEnv({ files: { '/proc/1/comm': 'init\n' } });
    expect(check(env, 'systemd-pid1').status).toBe('fail');
    expect(runDoctor(env).ok).toBe(false);
  });

  const distros: Array<[string, string, Record<string, string>]> = [
    [
      'arch',
      'ID=arch\n',
      {
        'systemd-run': 'sudo pacman -S --needed systemd',
        bwrap: 'sudo pacman -S --needed bubblewrap',
      },
    ],
    [
      'debian',
      'ID=ubuntu\nID_LIKE=debian\n',
      {
        'systemd-run': 'sudo apt install systemd',
        bwrap: 'sudo apt install bubblewrap',
      },
    ],
    [
      'fedora',
      'ID=fedora\n',
      {
        'systemd-run': 'sudo dnf install systemd',
        bwrap: 'sudo dnf install bubblewrap',
      },
    ],
    [
      'unknown',
      'ID=gentoo\n',
      Object.fromEntries(LINUX_TOOLS.map((t) => [t, `install the package that provides ${t}`])),
    ],
  ];

  for (const [name, osRelease, fixes] of distros) {
    it(`gives ${name} install fixes for each missing confinement tool`, () => {
      for (const tool of LINUX_TOOLS) {
        const env = linuxEnv({ osRelease, missing: [tool] });
        const c = check(env, `tool:${tool}`);
        expect(c.status).toBe('fail');
        expect(c.fix).toBe(fixes[tool]);
        expect(runDoctor(env).ok).toBe(false);
      }
    });
  }

  it('fails when unprivileged user namespaces are disabled', () => {
    for (const knob of [
      '/proc/sys/user/max_user_namespaces',
      '/proc/sys/kernel/unprivileged_userns_clone',
    ]) {
      const env = linuxEnv({ files: { [knob]: '0\n' } });
      expect(check(env, 'userns').status).toBe('fail');
      expect(runDoctor(env).ok).toBe(false);
    }
  });

  it('treats rhel-like hosts as dnf hosts', () => {
    const env = linuxEnv({
      osRelease: 'ID=rocky\nID_LIKE="rhel centos fedora"\n',
      missing: ['bwrap'],
    });
    expect(check(env, 'tool:bwrap').fix).toBe('sudo dnf install bubblewrap');
  });

  it('reports optional orb backends as info, not failures', () => {
    const env = linuxEnv({ missing: ['podman', 'systemd-nspawn', 'machinectl'] });
    expect(check(env, 'orb:podman').status).toBe('info');
    expect(check(env, 'orb:nspawn').status).toBe('info');
    expect(runDoctor(env).ok).toBe(true);
    expect(check(linuxEnv(), 'orb:podman').status).toBe('pass');
    expect(check(linuxEnv(), 'orb:nspawn').status).toBe('pass');
  });

  it('passes orb:nspawn only when both nspawn tools exist', () => {
    const env = linuxEnv({ missing: ['machinectl'] });
    expect(check(env, 'orb:nspawn').status).toBe('info');
  });

  it('requires Node 22.19 or newer', () => {
    const old = check(linuxEnv({ nodeVersion: '22.18.0' }), 'node');
    expect(old.status).toBe('fail');
    expect(old.fix).toBe('install Node 22.19 or newer');
    expect(check(linuxEnv({ nodeVersion: '22.19.0' }), 'node').status).toBe('pass');
  });

  it('fails when run as root', () => {
    const c = check(linuxEnv({ uid: 0 }), 'not-root');
    expect(c.status).toBe('fail');
    expect(c.fix).toBe('run cairn doctor as the account that will run tasks, without sudo');
  });

  it('fails when protected_hardlinks is off', () => {
    const env = linuxEnv({ files: { '/proc/sys/fs/protected_hardlinks': '0\n' } });
    const c = check(env, 'protected-hardlinks');
    expect(c.status).toBe('fail');
    expect(c.fix).toContain('sudo sysctl -w fs.protected_hardlinks=1');
    expect(c.fix).toContain('/etc/sysctl.d');
  });

  it('warns on low disk space', () => {
    const env = linuxEnv({ free: 4 * GIB });
    const c = check(env, 'disk');
    expect(c.status).toBe('warn');
    expect(c.detail).toContain('4.0 GiB');
    expect(runDoctor(env).ok).toBe(true);
  });
});

describe('doctor output', () => {
  it('renders marks, fix lines and the summary', () => {
    const result = runDoctor(linuxEnv({ missing: ['bwrap'] }));
    const text = formatDoctor(result);
    expect(text).toMatch(/^✓ /m);
    expect(text).toMatch(/^✗ .*bwrap/m);
    expect(text).toMatch(/^· /m);
    expect(text).toContain('Fix: sudo pacman -S --needed bubblewrap');
    expect(text.trimEnd().split('\n').at(-1)).toBe('1 problem(s) found.');
  });

  it('prints the all-clear line when nothing fails', () => {
    const text = formatDoctor(runDoctor(linuxEnv()));
    expect(text.trimEnd().split('\n').at(-1)).toBe('All required checks passed.');
  });

  it('sets the exit code from the result and prints parseable JSON', () => {
    let out = '';
    const code = runDoctorCommand(
      { json: true },
      { env: linuxEnv({ uid: 0 }), writeOut: (t) => (out += t) },
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(out) as { ok: boolean; checks: Array<{ id: string }> };
    expect(parsed.ok).toBe(false);
    expect(parsed.checks.map((c) => c.id)).toContain('not-root');
  });

  it('registers the doctor command with a --json option', () => {
    const doctor = buildProgram().commands.find((c) => c.name() === 'doctor');
    expect(doctor?.description()).toBe('Check whether this machine is ready to run Cairn tasks');
    expect(doctor?.options.map((o) => o.long)).toContain('--json');
  });
});
