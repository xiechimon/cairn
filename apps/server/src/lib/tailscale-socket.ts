import { chmodSync, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { dirname, isAbsolute } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import type { Hono } from 'hono';

import { tailscaleSocketFetch } from './token-auth.js';

export async function listenTailscaleSocket(app: Hono, path: string): Promise<Server> {
  if (!isAbsolute(path)) throw new Error('CAIRN_TAILSCALE_SOCKET must be an absolute path');
  const parent = lstatSync(realpathSync(dirname(path)));
  if (!parent.isDirectory() || (parent.mode & 0o022) !== 0) {
    throw new Error('CAIRN_TAILSCALE_SOCKET parent must not be writable by group or others');
  }
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('Unix socket ownership is unavailable');
  let existing: ReturnType<typeof lstatSync> | undefined;
  try {
    existing = lstatSync(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (existing !== undefined) {
    if (!existing.isSocket() || existing.uid !== uid) {
      throw new Error('CAIRN_TAILSCALE_SOCKET exists and is not a socket owned by the server user');
    }
    await new Promise<void>((resolve, reject) => {
      const probe = connect(path);
      probe.setTimeout(1_000, () => {
        probe.destroy();
        reject(new Error('CAIRN_TAILSCALE_SOCKET liveness check timed out'));
      });
      probe.once('connect', () => {
        probe.destroy();
        reject(new Error('CAIRN_TAILSCALE_SOCKET is already in use'));
      });
      probe.once('error', (error) => {
        if ('code' in error && error.code === 'ECONNREFUSED') resolve();
        else reject(error);
      });
    });
    const current = lstatSync(path);
    if (
      !current.isSocket() ||
      current.uid !== uid ||
      current.ino !== existing.ino ||
      current.dev !== existing.dev
    ) {
      throw new Error('CAIRN_TAILSCALE_SOCKET changed during stale socket validation');
    }
    unlinkSync(path);
  }
  const server = createServer(getRequestListener(tailscaleSocketFetch(app)));
  return new Promise<Server>((resolve, reject) => {
    server.once('error', reject);
    const previousUmask = process.umask(0o177);
    try {
      server.listen(path, () => {
        try {
          chmodSync(path, 0o600);
          const created = lstatSync(path);
          if (!created.isSocket() || created.uid !== uid || (created.mode & 0o777) !== 0o600) {
            throw new Error('CAIRN_TAILSCALE_SOCKET ownership or permissions are unsafe');
          }
          resolve(server);
        } catch (error) {
          server.close();
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
    } finally {
      process.umask(previousUmask);
    }
  });
}
