import { expect, test } from 'vitest';
import { conditionalFeedbackFetch } from '../src/lib/github-feedback-cache.js';

test('conditional feedback reads preserve native Response fields and reuse 304 bodies without parsing them', async () => {
  const requests: (string | undefined)[] = [];
  const cachedFetch = conditionalFeedbackFetch(async (_input, init) => {
    requests.push(init?.headers?.['if-none-match']);
    return requests.length === 1
      ? new Response(JSON.stringify({ state: 'open', merged: false }), {
          headers: { etag: '"first"' },
        })
      : new Response(null, { status: 304 });
  });
  const first = await cachedFetch('https://api.github.com/repos/octo/demo/pulls/42');
  expect(first.ok).toBe(true);
  expect(first.status).toBe(200);
  expect(first.headers.get('etag')).toBe('"first"');
  expect(await first.json()).toEqual({ state: 'open', merged: false });
  const second = await cachedFetch('https://api.github.com/repos/octo/demo/pulls/42');
  expect(second.ok).toBe(true);
  expect(await second.json()).toEqual({ state: 'open', merged: false });
  expect(requests).toEqual([undefined, '"first"']);
});

test('conditional feedback caches remain scoped to the credential and retry failed reads', async () => {
  const etags: (string | undefined)[] = [];
  let failed = false;
  const cachedFetch = conditionalFeedbackFetch(async (_input, init) => {
    etags.push(init?.headers?.['if-none-match']);
    if (failed) return new Response(null, { status: 502 });
    return new Response('[]', { headers: { etag: '"first"' } });
  });
  const url = 'https://api.github.com/repos/octo/demo/pulls/42';
  await cachedFetch(url, { headers: { authorization: 'Bearer a' } });
  await cachedFetch(url, { headers: { authorization: 'Bearer A' } });
  failed = true;
  expect((await cachedFetch(url, { headers: { authorization: 'Bearer a' } })).status).toBe(502);
  failed = false;
  await cachedFetch(url, { headers: { authorization: 'Bearer a' } });
  expect(etags).toEqual([undefined, undefined, '"first"', '"first"']);
});
