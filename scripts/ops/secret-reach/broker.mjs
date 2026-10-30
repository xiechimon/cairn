import { createSign } from 'node:crypto';
import { chmodSync, chownSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const permissions = { contents: 'write', pull_requests: 'write', issues: 'write' };

export async function mintToken(request, config) {
  if (
    !request ||
    Object.keys(request).sort().join(',') !== 'permissions,repository,type' ||
    request.type !== 'mint' ||
    request.repository !== 'xiechimon/cairn' ||
    !request.permissions ||
    Object.keys(request.permissions).sort().join(',') !==
      Object.keys(permissions).sort().join(',') ||
    Object.entries(permissions).some(([key, value]) => request.permissions[key] !== value)
  )
    throw new Error('request refused');
  if (!/^\d+$/.test(config.appId) || !/^\d+$/.test(config.installationId))
    throw new Error('Invalid broker configuration');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.appId }),
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(config.privateKey, 'base64url');
  const response = await (config.fetch ?? fetch)(
    `https://api.github.com/app/installations/${config.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${signingInput}.${signature}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ repositories: ['cairn'], permissions }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error('GitHub request failed');
  const body = await response.json();
  if (typeof body.token !== 'string' || typeof body.expires_at !== 'string')
    throw new Error('Invalid GitHub response');
  return { token: body.token, expires_at: body.expires_at };
}

export async function createBroker(config) {
  if (existsSync(config.socketPath)) throw new Error('Socket path already exists');
  if (!Number.isInteger(config.groupId) || config.groupId < 0)
    throw new Error('Invalid socket group');
  const server = createServer((socket) => {
    let input = '';
    let handled = false;
    socket.setTimeout(15000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async (data) => {
      if (handled) return;
      input += data.toString('utf8');
      if (Buffer.byteLength(input) > 8192) {
        handled = true;
        socket.end(`${JSON.stringify({ error: 'request refused' })}\n`);
        return;
      }
      if (!input.includes('\n')) return;
      handled = true;
      try {
        const result = await mintToken(JSON.parse(input.trim()), config);
        socket.end(`${JSON.stringify(result)}\n`);
      } catch {
        socket.end(`${JSON.stringify({ error: 'request refused' })}\n`);
      }
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(config.socketPath, () => {
      try {
        chownSync(config.socketPath, process.getuid(), config.groupId);
        chmodSync(config.socketPath, 0o660);
        resolveListen();
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o117);
  await createBroker({
    appId: process.env.CAIRN_GITHUB_APP_ID,
    installationId: process.env.CAIRN_GITHUB_INSTALLATION_ID,
    privateKey: readFileSync(process.env.CAIRN_GITHUB_APP_KEY),
    socketPath: process.env.CAIRN_BROKER_SOCKET,
    groupId: Number(process.env.CAIRN_BROKER_GID),
  });
}
