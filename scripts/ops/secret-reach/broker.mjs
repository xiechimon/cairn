import { sign } from 'node:crypto';
import { chmodSync, lstatSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';

export const scope = Object.freeze({
  repositories: Object.freeze(['cairn']),
  permissions: Object.freeze({ contents: 'write', pull_requests: 'write', issues: 'write' }),
});

function samePermissions(value, metadata = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected =
    metadata && value.metadata === 'read'
      ? { ...scope.permissions, metadata: 'read' }
      : scope.permissions;
  return (
    Object.keys(value).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, level]) => value[key] === level)
  );
}

export function createTokenMinter({ appId, installationId, privateKey, fetchImpl = fetch }) {
  if (!/^[1-9]\d*$/.test(appId) || !/^[1-9]\d*$/.test(installationId))
    throw new Error('Invalid broker identity');
  return async (request) => {
    if (
      !request ||
      Object.keys(request).length !== 3 ||
      request.operation !== 'token' ||
      request.repository !== 'xiechimon/cairn' ||
      !samePermissions(request.permissions)
    )
      throw new Error('Scope refused');
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
    ).toString('base64url');
    const jwt = `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url')}`;
    const headers = {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'cairn-token-broker',
    };
    try {
      const installation = await fetchImpl(
        `https://api.github.com/app/installations/${installationId}`,
        { headers, redirect: 'error', signal: AbortSignal.timeout(10000) },
      );
      if (!installation.ok || (await installation.json()).account?.login !== 'xiechimon')
        throw new Error('Installation refused');
      const response = await fetchImpl(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(scope),
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw new Error('Token refused');
      const token = await response.json();
      if (
        typeof token.token !== 'string' ||
        !token.token.length ||
        !samePermissions(token.permissions, true) ||
        (token.repository_selection !== undefined && token.repository_selection !== 'selected') ||
        (token.repositories !== undefined &&
          (!Array.isArray(token.repositories) ||
            token.repositories.length !== 1 ||
            token.repositories[0]?.full_name !== 'xiechimon/cairn')) ||
        !Number.isFinite(Date.parse(token.expires_at)) ||
        Date.parse(token.expires_at) <= Date.now()
      )
        throw new Error('Token scope refused');
      return { token: token.token, expires_at: token.expires_at };
    } catch {
      throw new Error('Token request refused');
    }
  };
}

export async function startBroker({ socketPath, runnerGid, mint }) {
  const dir = dirname(socketPath);
  const stat = lstatSync(dir);
  if (
    !Number.isInteger(runnerGid) ||
    runnerGid < 0 ||
    !stat.isDirectory() ||
    realpathSync(dir) !== dir ||
    stat.uid !== process.getuid() ||
    stat.gid !== runnerGid ||
    (stat.mode & 0o7777) !== 0o2710
  )
    throw new Error('Unsafe socket directory');
  try {
    lstatSync(socketPath);
    throw new Error('Socket path exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const server = createServer((socket) => {
    let input = '';
    let handled = false;
    socket.setEncoding('utf8');
    socket.setTimeout(15000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async (chunk) => {
      if (handled) return;
      input += chunk;
      if (
        Buffer.byteLength(input) > 4096 ||
        (input.includes('\n') && !input.endsWith('\n')) ||
        input.indexOf('\n') !== input.lastIndexOf('\n')
      ) {
        handled = true;
        socket.end(`${JSON.stringify({ error: 'request refused' })}\n`);
        return;
      }
      if (!input.endsWith('\n')) return;
      handled = true;
      try {
        socket.end(`${JSON.stringify(await mint(JSON.parse(input)))}\n`);
      } catch {
        socket.end(`${JSON.stringify({ error: 'request refused' })}\n`);
      }
    });
  });
  server.maxConnections = 64;
  const oldMask = process.umask(0o077);
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolveListen);
    });
    const socketStat = lstatSync(socketPath);
    if (socketStat.gid !== runnerGid) throw new Error('Socket group mismatch');
    chmodSync(socketPath, 0o660);
  } catch (error) {
    server.close();
    throw error;
  } finally {
    process.umask(oldMask);
  }
  return {
    close: () =>
      new Promise((resolveClose) =>
        server.close(() => {
          try {
            unlinkSync(socketPath);
          } catch {}
          resolveClose();
        }),
      ),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    if (process.getuid() === 0 || process.argv.length !== 2) throw new Error('Run as the owner');
    const mint = createTokenMinter({
      appId: process.env.CAIRN_BROKER_APP_ID,
      installationId: process.env.CAIRN_BROKER_INSTALLATION_ID,
      privateKey: readFileSync('/home/ian/.cairn/cairnwright.private-key.pem'),
    });
    const broker = await startBroker({
      socketPath: '/run/cairn-token-broker/broker.sock',
      runnerGid: Number(process.env.CAIRN_BROKER_RUNNER_GID),
      mint,
    });
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, async () => {
        await broker.close();
        process.exit(0);
      });
    process.stdout.write('Token broker ready\n');
  } catch {
    process.stderr.write('Token broker startup refused\n');
    process.exitCode = 1;
  }
}
