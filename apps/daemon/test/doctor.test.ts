import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli.js';
import { type DoctorEnv, formatDoctor, runDoctor, runDoctorCommand } from '../src/doctor.js';

const GIB = 1024 ** 3;

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
  it('reports runner readiness without requiring seatbelt or a VM runtime', () => {
    const result = runDoctor(
      fakeEnv({ platform: 'darwin', missing: ['sandbox-exec', 'container'] }),
    );
    expect(result.ok).toBe(true);
    expect(check(fakeEnv({ platform: 'darwin' }), 'macos').status).toBe('pass');
    expect(result.checks.map((c) => c.id)).toEqual([
      'macos',
      'node',
      'not-root',
      'disk',
      'versions',
    ]);
  });
});

describe('runDoctor on Windows', () => {
  it('reports runner readiness on Windows hosts', () => {
    const result = runDoctor(fakeEnv({ platform: 'win32' }));
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.id)).toEqual(['windows', 'node', 'disk']);
  });
});

describe('runDoctor on Linux', () => {
  it('passes without systemd or bubblewrap and reports kernel version', () => {
    const result = runDoctor(linuxEnv({ missing: ['systemd-run', 'bwrap'] }));
    expect(result.ok).toBe(true);
    expect(result.checks.filter((c) => c.status === 'fail')).toEqual([]);
    const versions = check(linuxEnv(), 'versions');
    expect(versions.status).toBe('info');
    expect(versions.detail).toContain('kernel 7.2.0-arch1-1');
  });

  it('fails on unsupported platforms', () => {
    const result = runDoctor(fakeEnv({ platform: 'freebsd' }));
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ id: 'platform', status: 'fail' });
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
    const result = runDoctor(linuxEnv({ nodeVersion: '22.18.0' }));
    const text = formatDoctor(result);
    expect(text).toMatch(/^✓ /m);
    expect(text).toMatch(/^✗ .*Node/m);
    expect(text).toMatch(/^· /m);
    expect(text).toContain('Fix: install Node 22.19 or newer');
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
