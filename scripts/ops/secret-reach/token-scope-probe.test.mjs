import assert from 'node:assert/strict';
import test from 'node:test';
import { ABSENT, runProbes, scopeProbes } from './token-scope-probe.mjs';

const probes = scopeProbes('xiechimon/cairn', 'xiechimon/agents-config');

test('every write probe targets a resource that does not exist and carries no body', () => {
  const writes = probes.filter((p) => p.method !== 'GET');
  assert.ok(writes.length >= 3);
  for (const probe of writes) {
    assert.equal(probe.method, 'DELETE', probe.label);
    assert.ok(
      probe.path.includes(ABSENT) ||
        probe.path.toLowerCase().includes(ABSENT.replaceAll('-', '_')) ||
        /\/hooks\/1$/.test(probe.path),
      probe.label,
    );
    assert.equal(probe.body, undefined, probe.label);
  }
});

test('the destructive branch protection PUT from the 2026-10-30 probe is not in the list', () => {
  assert.ok(
    !probes.some((p) => p.method === 'PUT' && p.path.endsWith('/branches/main/protection')),
  );
});

test('a token with admin rights fails the run: 404 on an absent branch means the write was authorized', async () => {
  const results = await runProbes('t', probes, async (url) => ({
    status: url.includes(`/branches/${ABSENT}/protection`)
      ? 404
      : url.includes('/installation/') || url.includes('/pulls')
        ? 200
        : url.includes('agents-config')
          ? 404
          : 403,
  }));
  assert.equal(
    results.find((r) => r.path.includes(ABSENT) && r.path.includes('branches')).ok,
    false,
  );
});

test('requests never send a body', async () => {
  await runProbes('t', probes, async (_url, options) => {
    assert.equal(options.body, undefined);
    return { status: 0 };
  });
});
