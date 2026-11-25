import { describe, expect, it, vi } from 'vitest';
import type { DesktopHostBridge, DesktopHostStatus } from '../src/desktop-shell.js';
import { addAndSwitchRemoteHost, parseRemoteHostOrigin } from '../src/resources/remote-host.js';

describe('parseRemoteHostOrigin', () => {
  it('normalizes origin and derives the default host name from hostname', () => {
    expect(parseRemoteHostOrigin(' https://studio-mac.tail4c2a.ts.net/app/settings ')).toEqual({
      origin: 'https://studio-mac.tail4c2a.ts.net',
      defaultName: 'studio-mac',
    });
    expect(parseRemoteHostOrigin('http://100.64.0.12:8787/')).toEqual({
      origin: 'http://100.64.0.12:8787',
      defaultName: '100.64.0.12',
    });
  });

  it('rejects empty, relative, or non-http URLs', () => {
    expect(parseRemoteHostOrigin('')).toBeNull();
    expect(parseRemoteHostOrigin('studio-mac.tail4c2a.ts.net')).toBeNull();
    expect(parseRemoteHostOrigin('ftp://studio-mac.tail4c2a.ts.net')).toBeNull();
    expect(parseRemoteHostOrigin('javascript:alert(1)')).toBeNull();
  });
});

describe('addAndSwitchRemoteHost', () => {
  it('saves with the derived host name when omitted and switches immediately', async () => {
    const remoteStatus: DesktopHostStatus = {
      activeId: 'local',
      connections: [
        { id: 'local', kind: 'local', name: 'This computer', url: null },
        {
          id: 'remote-1234',
          kind: 'remote',
          name: 'studio-mac',
          url: 'https://studio-mac.tail4c2a.ts.net',
        },
      ],
      residentSupported: false,
      residentInstalled: false,
      attachedToResident: false,
    };
    const addRemote = vi.fn().mockResolvedValue(remoteStatus);
    const switchHost = vi.fn().mockResolvedValue({ ...remoteStatus, activeId: 'remote-1234' });
    const bridge: DesktopHostBridge = {
      status: vi.fn(),
      addRemote,
      removeRemote: vi.fn(),
      switch: switchHost,
      setResident: vi.fn(),
    };

    await addAndSwitchRemoteHost(bridge, { url: 'https://studio-mac.tail4c2a.ts.net/app' });
    expect(addRemote).toHaveBeenCalledWith({
      name: 'studio-mac',
      url: 'https://studio-mac.tail4c2a.ts.net',
    });
    expect(switchHost).toHaveBeenCalledWith('remote-1234');
  });

  it('prefers the explicit host name when provided and throws on invalid URLs', async () => {
    const remoteStatus: DesktopHostStatus = {
      activeId: 'local',
      connections: [
        { id: 'local', kind: 'local', name: 'This computer', url: null },
        { id: 'remote-9', kind: 'remote', name: 'Work Mac', url: 'http://mac-mini.local:8787' },
      ],
      residentSupported: false,
      residentInstalled: false,
      attachedToResident: false,
    };
    const addRemote = vi.fn().mockResolvedValue(remoteStatus);
    const switchHost = vi.fn().mockResolvedValue(remoteStatus);
    const bridge: DesktopHostBridge = {
      status: vi.fn(),
      addRemote,
      removeRemote: vi.fn(),
      switch: switchHost,
      setResident: vi.fn(),
    };

    await expect(addAndSwitchRemoteHost(bridge, { url: 'not-a-url' })).rejects.toThrow(
      'Invalid remote host URL',
    );
    await addAndSwitchRemoteHost(bridge, {
      name: '  Work Mac ',
      url: 'http://mac-mini.local:8787',
    });
    expect(addRemote).toHaveBeenCalledWith({
      name: 'Work Mac',
      url: 'http://mac-mini.local:8787',
    });
    expect(switchHost).toHaveBeenCalledWith('remote-9');
  });
});
