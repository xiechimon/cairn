import assert from 'node:assert/strict';
import test from 'node:test';
import { ABSENT, runProbes, scopeProbes } from './token-scope-probe.mjs';

const sha = 'a'.repeat(40);
const probes = scopeProbes('xiechimon/cairn', 'xiechimon/agents-config', sha);

test('writes are absent-resource deletes, an absent PR merge, or current-main no-op', () => {
  for (const probe of probes.filter((p) => p.method !== 'GET')) {
    if (probe.method === 'PATCH') {
      assert.equal(probe.path, '/repos/xiechimon/cairn/git/refs/heads/main');
      assert.deepEqual(probe.body, { sha, force: false });
    } else if (probe.method === 'PUT') {
      assert.equal(probe.path, '/repos/xiechimon/cairn/pulls/999999999/merge');
    } else {
      assert.equal(probe.method, 'DELETE');
      assert.ok(
        probe.path.includes(ABSENT) ||
          probe.path.includes(ABSENT.replaceAll('-', '_').toUpperCase()) ||
          probe.path.endsWith('/hooks/999999999'),
      );
      assert.equal(probe.body, undefined);
    }
  }
  assert.ok(probes.some((p) => p.method === 'PATCH'));
  assert.ok(probes.some((p) => p.method === 'PUT'));
});
test('main update requires a valid current SHA', () => {
  assert.throws(() => scopeProbes('xiechimon/cairn', 'other/repo', ''), /SHA/);
});
test('authorized main updates and merges fail and requests serialize safe bodies', async () => {
  const seen = [];
  const results = await runProbes('fixture-token', probes, async (url, options) => {
    seen.push({ url, ...options });
    return { status: 200 };
  });
  assert.equal(results.find((r) => r.method === 'PATCH').ok, false);
  assert.equal(results.find((r) => r.method === 'PUT').ok, false);
  assert.deepEqual(JSON.parse(seen.find((r) => r.method === 'PATCH').body), { sha, force: false });
});
test('branch protection refusal and absent merge are accepted', async () => {
  const results = await runProbes('fixture-token', probes, async (url, options) => ({
    json: async () => ({ message: 'Protected branch update failed' }),
    status:
      options.method === 'PATCH'
        ? 422
        : options.method === 'PUT'
          ? 404
          : url.includes('agents-config')
            ? 404
            : options.method === 'GET' && !url.includes('protection')
              ? 200
              : 403,
  }));
  assert.ok(results.every((r) => r.ok));
});

test('generic validation failure does not establish branch protection', async () => {
  const results = await runProbes('t', probes, async () => ({
    status: 422,
    json: async () => ({ message: 'Invalid SHA' }),
  }));
  assert.equal(results.find((r) => r.method === 'PATCH').ok, false);
});
