import { createConnection } from 'node:net';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ABSENT = 'cairn-scope-probe-absent';

export function scopeProbes(repo, otherRepo, mainSha) {
  if (!/^[0-9a-f]{40}$/.test(mainSha ?? '')) throw new Error('Invalid current main SHA');
  return [
    {
      label: 'main update branch protection',
      method: 'PATCH',
      path: `/repos/${repo}/git/refs/heads/main`,
      body: { sha: mainSha, force: false },
      expect: [403, 422],
    },
    {
      label: 'absent PR merge',
      method: 'PUT',
      path: `/repos/${repo}/pulls/999999999/merge`,
      expect: [403, 404],
    },
    {
      label: 'installation repositories',
      method: 'GET',
      path: '/installation/repositories',
      expect: 200,
    },
    {
      label: 'pull request read',
      method: 'GET',
      path: `/repos/${repo}/pulls?per_page=1`,
      expect: 200,
    },
    {
      label: 'branch protection read',
      method: 'GET',
      path: `/repos/${repo}/branches/main/protection`,
      expect: 403,
    },
    {
      label: 'branch protection write on an absent branch',
      method: 'DELETE',
      path: `/repos/${repo}/branches/${ABSENT}/protection`,
      expect: 403,
    },
    {
      label: 'actions variable delete of an absent variable',
      method: 'DELETE',
      path: `/repos/${repo}/actions/variables/${ABSENT.replaceAll('-', '_').toUpperCase()}`,
      expect: 403,
    },
    {
      label: 'webhook delete of an absent hook',
      method: 'DELETE',
      path: `/repos/${repo}/hooks/999999999`,
      expect: 403,
    },
    { label: 'other repository read', method: 'GET', path: `/repos/${otherRepo}`, expect: 404 },
  ];
}

export async function runProbes(token, probes, fetchImpl = fetch) {
  const results = [];
  for (const probe of probes) {
    const response = await fetchImpl(`https://api.github.com${probe.path}`, {
      method: probe.method,
      body: probe.body === undefined ? undefined : JSON.stringify(probe.body),
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    let message = '';
    if (probe.method === 'PATCH') {
      try {
        const body = await response.json();
        message =
          typeof body.message === 'string'
            ? body.message
                .replaceAll(token, '[redacted]')
                .replace(/[\r\n]/g, ' ')
                .slice(0, 500)
            : '';
      } catch {}
    }
    results.push({
      ...probe,
      message,
      status: response.status,
      ok:
        (Array.isArray(probe.expect) ? probe.expect : [probe.expect]).includes(response.status) &&
        (probe.method !== 'PATCH' || /protected branch|GH006|GH013|repository rule/i.test(message)),
    });
  }
  return results;
}

export async function requestToken(socketPath) {
  if (typeof socketPath !== 'string' || !isAbsolute(socketPath))
    throw new Error('Need absolute socket path');
  return new Promise((resolveToken, reject) => {
    const socket = createConnection(socketPath);
    let output = '';
    const fail = () => {
      socket.destroy();
      reject(new Error('Broker request failed'));
    };
    socket.setTimeout(15000, fail);
    socket.on('error', fail);
    socket.on('connect', () =>
      socket.write(
        `${JSON.stringify({ type: 'mint', repository: 'xiechimon/cairn', permissions: { contents: 'write', pull_requests: 'write', issues: 'write' } })}\n`,
      ),
    );
    socket.on('data', (data) => {
      output += data.toString('utf8');
      if (Buffer.byteLength(output) > 8192) fail();
    });
    socket.on('end', () => {
      try {
        const body = JSON.parse(output);
        if (typeof body.token !== 'string' || !body.token || typeof body.expires_at !== 'string')
          return fail();
        resolveToken(body.token);
      } catch {
        fail();
      }
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const token = await requestToken(process.argv[2]);
  const response = await fetch('https://api.github.com/repos/xiechimon/cairn/git/ref/heads/main', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Current main lookup failed');
  const main = await response.json();
  const results = await runProbes(
    token,
    scopeProbes('xiechimon/cairn', process.argv[3] ?? 'xiechimon/agents-config', main.object?.sha),
  );
  for (const r of results)
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'} ${r.label}: ${r.method} ${r.path} -> ${r.status} (expect ${r.expect}) ${r.message}`,
    );
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
