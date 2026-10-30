import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mintToken } from './broker.mjs';

export const ABSENT = 'cairn-scope-probe-absent';

export function scopeProbes(repo, otherRepo) {
  return [
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
      path: `/repos/${repo}/hooks/1`,
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
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    results.push({ ...probe, status: response.status, ok: response.status === probe.expect });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = JSON.parse(readFileSync(`${homedir()}/.cairn/cairn-bot.json`, 'utf8'));
  const privateKey = readFileSync(config.privateKeyPath.replace(/^~/, homedir()), 'utf8');
  const minted = await mintToken(
    {
      type: 'mint',
      repository: 'xiechimon/cairn',
      permissions: { contents: 'write', pull_requests: 'write', issues: 'write' },
    },
    { appId: String(config.appId), installationId: String(config.installationId), privateKey },
  );
  const results = await runProbes(
    minted.token,
    scopeProbes('xiechimon/cairn', process.argv[2] ?? 'xiechimon/agents-config'),
  );
  for (const r of results)
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'} ${r.label}: ${r.method} ${r.path} -> ${r.status} (expect ${r.expect})`,
    );
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
