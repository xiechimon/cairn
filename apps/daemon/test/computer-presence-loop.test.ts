import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { ComputerPresence, MachinePresenceBody } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { ComputerPresenceReporter } from '../src/computer/presence.js';
import { loadDaemonConfig } from '../src/config.js';
import type { DaemonLogger } from '../src/log.js';
import { MachineClient } from '../src/machine-client.js';
import { runMachine } from '../src/machine-loop.js';
import { computerMachineName } from '../src/orb/computer.js';
import { statePaths } from '../src/state.js';
import { FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

vi.mock('../src/claude-code-bin.js', () => ({ probeClaudeBin: async () => null }));

describe('computer presence machine wiring', () => {
  test('startup, immediate changes and periodic observations reach machine presence and stop cleanly', async () => {
    const home = makeTestTempDir('computer-presence-loop-');
    const api = new FakeMachineApi();
    const listeners = new Set<() => void>();
    let state: ComputerPresence['state'] = 'running';
    const report = (): ComputerPresence => ({
      scopeKey: 'chief:one',
      providerRef: 'orb-one',
      state,
    });
    const logger = Object.fromEntries(
      [
        'raw',
        'prefixed',
        'supervisor',
        'machine',
        'step',
        'workspace',
        'recover',
        'wake',
        'mcp',
        'skills',
        'gate',
        'trust',
      ].map((key) => [key, vi.fn()]),
    ) as unknown as DaemonLogger;
    const config = loadDaemonConfig(
      { home, serverUrl: 'http://server', apiKey: 'test', teamId: 'team-1' },
      {},
    );
    const handle = await runMachine({
      config,
      paths: statePaths(home, config.workspacesDir),
      logger,
      client: api,
      backend: fakeBackend([]).backend,
      claudeCodeAuthProbe: async () => ({ state: 'unknown', reason: 'test' }),
      capabilitiesProbe: () => ({ mcpServers: [], skills: [] }),
      computerPresence: {
        presence: async () => [report()],
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
      presenceIntervalMs: 100,
      idleSleepPrevention: false,
      proxyEnv: {},
      capEnv: {},
      otel: null,
    });
    try {
      expect((api.presenceBodies[0] as MachinePresenceBody).computers).toEqual([report()]);
      state = 'stopped';
      for (const listener of listeners) listener();
      await waitFor(() =>
        api.presenceBodies.some(
          (body) => (body as MachinePresenceBody).computers?.[0]?.state === 'stopped',
        ),
      );
      state = 'failed';
      await waitFor(() =>
        api.presenceBodies.some(
          (body) => (body as MachinePresenceBody).computers?.[0]?.state === 'failed',
        ),
      );
    } finally {
      await handle.stop();
      await handle.done;
      expect(listeners.size).toBe(0);
      expect(releaseTestTempDir(home)).toBe(true);
    }
  });

  test('a daemon with the Orb computer reports what machinectl shows running, not only while a call is open', async () => {
    const home = makeTestTempDir('computer-presence-orb-');
    const bin = join(home, 'bin');
    mkdirSync(bin);
    const scopeKey = 'chief:one';
    const name = computerMachineName(scopeKey);
    writeFileSync(
      join(bin, 'machinectl'),
      `#!/bin/sh\nif [ "$1" = list ]; then echo "${name} container systemd-nspawn - - 10.0.0.2"; fi\n`,
    );
    chmodSync(join(bin, 'machinectl'), 0o755);
    mkdirSync(join(home, 'orb-state'), { recursive: true });
    writeFileSync(
      join(home, 'orb-state', 'computers.json'),
      JSON.stringify([{ scopeKey, name, lastUsedAt: Date.now(), holdUntil: 0 }]),
    );
    vi.stubEnv('PATH', `${bin}:${process.env.PATH ?? ''}`);
    const api = new FakeMachineApi();
    const logger = Object.fromEntries(
      [
        'raw',
        'prefixed',
        'supervisor',
        'machine',
        'step',
        'workspace',
        'recover',
        'wake',
        'mcp',
        'skills',
        'gate',
        'trust',
      ].map((key) => [key, vi.fn()]),
    ) as unknown as DaemonLogger;
    const config = loadDaemonConfig(
      { home, serverUrl: 'http://server', apiKey: 'test', teamId: 'team-1' },
      {},
    );
    const handle = await runMachine({
      config,
      paths: statePaths(home, config.workspacesDir),
      logger,
      client: api,
      backend: fakeBackend([]).backend,
      claudeCodeAuthProbe: async () => ({ state: 'unknown', reason: 'test' }),
      capabilitiesProbe: () => ({ mcpServers: [], skills: [] }),
      idleSleepPrevention: false,
      proxyEnv: {},
      capEnv: { CAIRN_COMPUTER: 'orb' },
      otel: null,
    });
    try {
      await waitFor(() =>
        api.presenceBodies.some((body) =>
          (body as MachinePresenceBody).computers?.some(
            (report) => report.providerRef === name && report.state === 'running',
          ),
        ),
      );
    } finally {
      await handle.stop();
      await handle.done;
      vi.unstubAllEnvs();
      expect(releaseTestTempDir(home)).toBe(true);
    }
  });

  test('deadline closes a real stalled HTTP presence request and keeps its bearer on the machine route', async () => {
    let disconnected = false;
    let received: { url?: string; authorization?: string; body: string } | undefined;
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        received = { url: request.url, authorization: request.headers.authorization, body };
      });
      response.on('close', () => {
        disconnected = true;
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const client = new MachineClient({
      serverUrl: `http://127.0.0.1:${address.port}`,
      getToken: () => 'test-machine-token',
    });
    const reporter = new ComputerPresenceReporter({
      body: () => ({ computers: [] }),
      send: (body, signal) => client.presence(body, signal),
      timeoutMs: 250,
    });
    try {
      await expect(reporter.send()).rejects.toThrow('presence');
      await waitFor(() => disconnected);
      expect(received).toEqual({
        url: '/api/machine/presence',
        authorization: 'Bearer test-machine-token',
        body: '{"computers":[]}',
      });
    } finally {
      await reporter.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
