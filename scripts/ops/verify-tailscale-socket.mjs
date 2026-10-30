import { lstatSync } from 'node:fs';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function probeStatus(options, headers) {
  return new Promise((resolveStatus, reject) => {
    const req = request({ ...options, path: '/api/teams', headers, agent: false }, (res) => {
      res.resume();
      res.once('end', () => resolveStatus(res.statusCode));
    });
    req.setTimeout(5_000, () => req.destroy(new Error('HTTP probe timed out')));
    req.once('error', reject);
    req.end();
  });
}

export async function verifyTailscaleSocket({ socketPath, tcpUrl, login, token }) {
  if (!token) throw new Error('An access token is required through CAIRN_TOKEN');
  const tcp = new URL(tcpUrl);
  if (
    tcp.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(tcp.hostname) ||
    tcp.username ||
    tcp.password
  ) {
    throw new Error('The TCP target must be a loopback HTTP URL');
  }
  if (!login) throw new Error('An allowlisted login is required');
  const socket = lstatSync(socketPath);
  if (!socket.isSocket() || socket.uid !== process.getuid?.() || (socket.mode & 0o777) !== 0o600) {
    throw new Error('Expected a mode 0600 socket owned by the probe user; run as the server user');
  }
  const tcpOptions = { hostname: tcp.hostname.replace(/^\[|\]$/g, ''), port: tcp.port || 80 };
  const identity = { 'tailscale-user-login': login };
  const cases = [
    ['TCP forged identity', tcpOptions, identity, 401],
    ['TCP bearer', tcpOptions, { authorization: `Bearer ${token}` }, 200],
    ['Unix allowed identity', { socketPath }, identity, 200],
    [
      'Unix unknown identity',
      { socketPath },
      { 'tailscale-user-login': `unknown-${Date.now()}@invalid` },
      401,
    ],
  ];
  const results = [];
  for (const [name, options, headers, expected] of cases) {
    const actual = await probeStatus(options, headers);
    results.push({ name, expected, actual, ok: actual === expected });
  }
  return {
    surface: 'live API',
    provider: 'not exercised',
    mode: socket.mode & 0o777,
    results,
    ok: results.every((result) => result.ok),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await verifyTailscaleSocket({
      socketPath: process.argv[2],
      tcpUrl: process.argv[3],
      login: process.argv[4],
      token: process.env.CAIRN_TOKEN,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
