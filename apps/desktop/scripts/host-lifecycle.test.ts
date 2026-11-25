import { createServer } from 'node:http';
import { describe, expect, test } from 'vitest';
import { LOCAL_CONNECTION_ID } from '../src/connections.js';
import { canInvokeHostIpc, canSwitchHost, probeRemoteReachable } from '../src/host-lifecycle.js';

describe('desktop host IPC boundary and reachability probe', () => {
  test('remote pages can only read host status or switch back to local', () => {
    expect(canInvokeHostIpc('remote', 'status')).toBe(true);
    expect(canInvokeHostIpc('remote', 'switch', LOCAL_CONNECTION_ID)).toBe(true);
    expect(canInvokeHostIpc('remote', 'switch', 'remote-evil')).toBe(false);
    expect(canInvokeHostIpc('remote', 'add-remote')).toBe(false);
    expect(canInvokeHostIpc('remote', 'remove-remote')).toBe(false);
    expect(canInvokeHostIpc('remote', 'set-resident')).toBe(false);

    expect(canInvokeHostIpc('local', 'add-remote')).toBe(true);
    expect(canInvokeHostIpc('local', 'remove-remote')).toBe(true);
    expect(canInvokeHostIpc('local', 'switch', 'remote-1')).toBe(true);
    expect(canInvokeHostIpc('local', 'set-resident')).toBe(true);

    expect(canSwitchHost('remote', false, LOCAL_CONNECTION_ID)).toBe(true);
    expect(canSwitchHost('remote', false, 'remote-2')).toBe(false);
    expect(canSwitchHost('remote', true, 'remote-2')).toBe(true);
    expect(canSwitchHost('remote', true, '')).toBe(false);
  });

  test('probeRemoteReachable accepts a reachable server even on 401 and rejects unreachable URLs', async () => {
    const srv = createServer((_req, res) => {
      res.statusCode = 401;
      res.end('Unauthorized');
    });
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    const address = srv.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      await expect(probeRemoteReachable(`http://127.0.0.1:${port}`, 2000)).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
    await expect(probeRemoteReachable(`http://127.0.0.1:${port}`, 1000)).rejects.toThrow();
  });
});
