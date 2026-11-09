import { sign } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildJwt(appId, privateKey, now = Date.now()) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iat: Math.floor(now / 1000) - 60,
      exp: Math.floor(now / 1000) + 540,
      iss: String(appId),
    }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
}

export function checkKeyPermissions(stat, uid) {
  if (stat.uid !== uid || (stat.mode & 0o077) !== 0 || (stat.mode & 0o170000) !== 0o100000) {
    throw new Error('unsafe private key permissions or owner');
  }
}

export function canReuseToken(cached, now = Date.now()) {
  return (
    cached !== null &&
    Number.isFinite(Date.parse(cached.expiresAt)) &&
    now < Date.parse(cached.expiresAt) - 300_000
  );
}

function safeMessage(value, secrets) {
  let message = typeof value === 'string' ? value : 'request failed';
  for (const secret of secrets) if (secret) message = message.split(secret).join('[redacted]');
  return message
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[redacted]')
    .replace(/(?:ghs_|ghp_|github_pat_)[A-Za-z0-9_]+/g, '[redacted]')
    .slice(0, 500);
}

export function createTokenSource(
  config,
  privateKey,
  { fetchImpl = globalThis.fetch, now = Date.now } = {},
) {
  let cached = null;
  let pending = null;
  let appSlug = null;
  async function mint() {
    const jwt = buildJwt(config.appId, privateKey, now());
    async function github(path, method) {
      let response;
      try {
        response = await fetchImpl(`https://api.github.com${path}`, {
          method,
          headers: {
            authorization: `Bearer ${jwt}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'cairn-app-token-mint',
          },
          signal: AbortSignal.timeout(15_000),
          redirect: 'error',
        });
      } catch {
        throw new Error('GitHub unavailable');
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`GitHub ${response.status}: invalid JSON`);
      }
      if (!response.ok)
        throw new Error(
          `GitHub ${response.status}: ${safeMessage(data?.message, [privateKey, jwt, cached?.token, data?.token])}`,
        );
      return data;
    }
    if (appSlug === null) {
      const app = await github('/app', 'GET');
      if (typeof app.slug !== 'string' || !/^[a-z0-9-]+$/.test(app.slug))
        throw new Error('GitHub 200: invalid app slug');
      appSlug = app.slug;
    }
    const data = await github(`/app/installations/${config.installationId}/access_tokens`, 'POST');
    const result = {
      token: data.token,
      expiresAt: data.expires_at,
      installationId: config.installationId,
      appSlug,
    };
    if (typeof result.token !== 'string' || !result.token || !canReuseToken(result, now()))
      throw new Error('GitHub 201: invalid token response');
    cached = result;
    return result;
  }
  return async (force = false) => {
    if (force) cached = null;
    if (pending !== null) return pending;
    if (canReuseToken(cached, now())) return cached;
    pending = mint();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}

function socketAnswers(path) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') resolve(false);
      else reject(new Error('socket path unavailable'));
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error('socket path probe timed out'));
    });
  });
}

export async function startMint(config, options = {}) {
  if (!/^[1-9]\d*$/.test(String(config.appId)) || !/^[1-9]\d*$/.test(String(config.installationId)))
    throw new Error('invalid app or installation id');
  if (typeof config.privateKeyPath !== 'string') throw new Error('missing private key path');
  const key = await open(config.privateKeyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let privateKey;
  try {
    checkKeyPermissions(await key.stat(), process.getuid());
    privateKey = await key.readFile('utf8');
    buildJwt(config.appId, privateKey);
  } finally {
    await key.close();
  }
  const socketPath =
    config.socketPath ??
    process.env.CAIRN_APP_TOKEN_SOCKET ??
    join(homedir(), '.cairn/run/app-token.sock');
  if (!isAbsolute(socketPath)) throw new Error('socket path must be absolute');
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  const parent = await lstat(dirname(socketPath));
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o022) !== 0)
    throw new Error('unsafe socket path directory');
  let existing;
  try {
    existing = await lstat(socketPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing) {
    if (!existing.isSocket() || existing.uid !== process.getuid())
      throw new Error('unsafe socket path');
    if (await socketAnswers(socketPath)) throw new Error('socket already active');
    const current = await lstat(socketPath).catch(() => null);
    if (current && current.ino === existing.ino && current.dev === existing.dev)
      await unlink(socketPath);
    else if (current) throw new Error('socket path changed during startup');
  }
  const source = createTokenSource(config, privateKey, options);
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    if (req.method === 'GET' && req.url === '/health') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method !== 'GET' || req.url !== '/token') {
      res.writeHead(404).end(JSON.stringify({ error: 'not found' }));
      return;
    }
    try {
      res.end(JSON.stringify(await source(req.headers['x-cairn-refresh'] === '1')));
    } catch (error) {
      res.writeHead(502).end(JSON.stringify({ error: safeMessage(error.message, [privateKey]) }));
    }
  });
  const mask = process.umask(0o177);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const socket = await lstat(socketPath);
    if ((socket.mode & 0o777) !== 0o600 || socket.uid !== process.getuid())
      throw new Error('unsafe socket permissions');
  } catch (error) {
    server.close();
    throw error;
  } finally {
    process.umask(mask);
  }
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const configPath =
      process.argv[2] ??
      process.env.CAIRN_APP_TOKEN_MINT_CONFIG ??
      join(homedir(), '.cairn/cairn-bot.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const server = await startMint(config);
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
  } catch {
    process.stderr.write(
      'App token mint startup failed; check config, private key permissions and socket path\n',
    );
    process.exitCode = 1;
  }
}
