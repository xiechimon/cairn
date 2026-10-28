import { existsSync, readdirSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { bootRealServer, type RealServer } from './helpers.js';

const servers: RealServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server !== undefined) await server.close();
  }
});

function ownedDirs(server: RealServer): string[] {
  return [
    server.reposDir,
    server.attachmentsDir,
    server.skillsDir,
    dirname(server.skillSourcesPath),
  ];
}

describe('bootRealServer fixture lifecycle', () => {
  test('bootRealServer.close() removes repos, skills, attachments and skill-sources dirs', async () => {
    const server = await bootRealServer({ providerBaseUrl: 'http://127.0.0.1:9' });
    servers.push(server);
    const dirs = ownedDirs(server);
    for (const dir of dirs) expect(existsSync(dir)).toBe(true);
    await server.close();
    servers.pop();
    for (const dir of dirs) expect(existsSync(dir)).toBe(false);
    expect(existsSync(server.mcpConfigPath)).toBe(false);
  });

  test('close() removes dirs only after server.close resolves', async () => {
    const server = await bootRealServer({ providerBaseUrl: 'http://127.0.0.1:9' });
    servers.push(server);
    const dirs = ownedDirs(server);
    let presentAtCloseCallback = false;
    const originalClose = http.Server.prototype.close;
    http.Server.prototype.close = function (
      this: http.Server,
      cb?: (err?: Error) => void,
    ): http.Server {
      return originalClose.call(this, (err?: Error) => {
        presentAtCloseCallback = dirs.every((dir) => existsSync(dir));
        cb?.(err);
      });
    };
    try {
      await server.close();
      servers.pop();
      expect(presentAtCloseCallback).toBe(true);
      for (const dir of dirs) expect(existsSync(dir)).toBe(false);
    } finally {
      http.Server.prototype.close = originalClose;
    }
  });

  test('twenty sequential boot/close cycles leave zero owned entries', async () => {
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('cairn-')));
    for (let i = 0; i < 20; i++) {
      const server = await bootRealServer({ providerBaseUrl: 'http://127.0.0.1:9' });
      await server.close();
    }
    const leaked = readdirSync(tmpdir()).filter(
      (name) => name.startsWith('cairn-') && !before.has(name),
    );
    expect(leaked).toEqual([]);
  });
});
