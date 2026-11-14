import { describe, expect, it } from 'vitest';
import {
  HOST_PERMISSIONS_REFRESH_MS,
  HostPermissionsProbe,
  parseAgentDesktopStatus,
} from '../src/host-permissions.js';

const STATUS_LINUX = JSON.stringify({
  version: '2.6',
  ok: true,
  command: 'status',
  data: {
    permissions: {
      accessibility: { state: 'granted' },
      automation: { state: 'not_required' },
      screen_recording: { state: 'unknown' },
    },
    platform: 'linux',
    ref_count: 81,
    session_id: null,
    snapshot_id: 's38w6wdxmj9m26',
    state_root: '/home/ian/.agent-desktop',
    supported_surfaces: ['window', 'sheet', 'alert', 'menu'],
    tracing: false,
    version: '1.1.0',
  },
});

const STATUS_MAC_DENIED = JSON.stringify({
  ok: true,
  data: {
    permissions: {
      accessibility: { state: 'denied' },
      automation: { state: 'not_required' },
      screen_recording: { state: 'denied' },
    },
    platform: 'macos',
  },
});

describe('parseAgentDesktopStatus', () => {
  it('keeps the three permission states from agent-desktop 1.1.0 status output', () => {
    expect(parseAgentDesktopStatus(STATUS_LINUX)).toEqual({
      accessibility: 'granted',
      automation: 'not_required',
      screenRecording: 'unknown',
    });
  });

  it('keeps denied states from a mac report', () => {
    expect(parseAgentDesktopStatus(STATUS_MAC_DENIED)).toEqual({
      accessibility: 'denied',
      automation: 'not_required',
      screenRecording: 'denied',
    });
  });

  it('reports nothing for an error envelope, non-JSON output, or an unknown state', () => {
    expect(
      parseAgentDesktopStatus(JSON.stringify({ ok: false, error: { code: 'INTERNAL' } })),
    ).toBeUndefined();
    expect(parseAgentDesktopStatus('agent-desktop: command not found')).toBeUndefined();
    expect(
      parseAgentDesktopStatus(
        JSON.stringify({
          ok: true,
          data: { permissions: { accessibility: { state: 'maybe' } } },
        }),
      ),
    ).toBeUndefined();
  });
});

describe('HostPermissionsProbe', () => {
  it('reports the first result only after the status run finishes, and reruns only after the refresh window', async () => {
    let clock = 0;
    let runs = 0;
    const probe = new HostPermissionsProbe(
      async () => {
        runs++;
        return STATUS_LINUX;
      },
      () => clock,
    );
    expect(probe.current()).toBeUndefined();
    await probe.settled();
    expect(probe.current()?.accessibility).toBe('granted');
    clock = HOST_PERMISSIONS_REFRESH_MS - 1;
    probe.current();
    expect(runs).toBe(1);
    clock = HOST_PERMISSIONS_REFRESH_MS;
    probe.current();
    await probe.settled();
    expect(runs).toBe(2);
  });

  it('drops an earlier report once the binary stops running', async () => {
    let clock = 0;
    let stdout: string | null = STATUS_LINUX;
    const probe = new HostPermissionsProbe(
      async () => stdout,
      () => clock,
    );
    probe.current();
    await probe.settled();
    expect(probe.current()).toBeDefined();
    stdout = null;
    clock = HOST_PERMISSIONS_REFRESH_MS;
    probe.current();
    await probe.settled();
    expect(probe.current()).toBeUndefined();
  });
});
