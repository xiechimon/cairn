import { expect, test } from 'vitest';
import { sandboxNotice } from '../src/resources/machine-detail-pane.js';

const GENERIC =
  '任务沙箱没就绪，这台执行机接不了任务。Linux 上后台服务要作为自己的 systemd user unit 运行，并装好 bubblewrap（`bwrap`）：更新 CLI 后在这台机器上运行 `{command} restart`。';

const unavailable = (reason: 'startup-failed' | 'cleanup-failed', confinementCause?: unknown) =>
  ({
    mcpServers: [],
    skills: [],
    osPlatform: 'linux',
    confinement: {
      state: 'unavailable',
      reason,
      invocation: '7d4f6a2e-8b1c-4e3a-9f5d-2c6b8a1e4f70',
      generation: 3,
      revision: 2,
    },
    ...(confinementCause === undefined ? {} : { confinementCause }),
  }) as Parameters<typeof sandboxNotice>[0];

test('each sandbox cause names its own fix', () => {
  expect(sandboxNotice(unavailable('startup-failed', { kind: 'bwrap-missing' }))).toContain(
    'bubblewrap',
  );
  expect(sandboxNotice(unavailable('startup-failed', { kind: 'not-own-unit' }))).toContain(
    'systemd-run --user',
  );
  expect(
    sandboxNotice(
      unavailable('startup-failed', { kind: 'home-overlay-failed', mountPoint: '/home/u/.m' }),
    ),
  ).toContain('{mountPoint}');
  expect(
    sandboxNotice(unavailable('startup-failed', { kind: 'home-overlay-failed' })),
  ).toContain('findmnt');
  const tooOld = sandboxNotice(unavailable('startup-failed', { kind: 'bwrap-too-old' }));
  expect(tooOld).toContain('0.11');
  expect(tooOld).toContain('/usr/local/bin/bwrap');
  expect(tooOld).toContain('#sandbox-on-ubuntu-2404-and-debian-12');
  const denied = sandboxNotice(unavailable('startup-failed', { kind: 'userns-denied' }));
  expect(denied).toContain('AppArmor');
  expect(denied).toContain('kernel.unprivileged_userns_clone=1');
  expect(denied).toContain('#sandbox-on-ubuntu-2404-and-debian-12');
});

test('no cause, an unknown cause, or a stale cause on a cleanup failure keeps the generic notice', () => {
  expect(sandboxNotice(unavailable('startup-failed'))).toBe(GENERIC);
  expect(sandboxNotice(unavailable('startup-failed', { kind: 'kernel-too-old' }))).toBe(GENERIC);
  expect(sandboxNotice(unavailable('cleanup-failed', { kind: 'bwrap-missing' }))).toBe(GENERIC);
});
