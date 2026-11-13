import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { bootServer, req } from './helpers.js';

describe('API response compression', () => {
  test('a JSON list above the threshold is gzipped and decodes to the same body', async () => {
    const s = bootServer();
    for (let i = 0; i < 20; i += 1) {
      await req(s.app, 'POST', '/api/projects', { name: `project-with-a-long-name-${i}` });
    }
    const path = `/api/projects?teamId=${s.team.id}`;
    const plain = await s.app.request(path);
    const plainBody = await plain.text();
    expect(plainBody.length).toBeGreaterThan(1024);
    expect(plain.headers.get('content-encoding')).toBeNull();

    const zipped = await s.app.request(path, { headers: { 'accept-encoding': 'gzip' } });
    expect(zipped.status).toBe(200);
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    const raw = Buffer.from(await zipped.arrayBuffer());
    expect(raw.length).toBeLessThan(plainBody.length);
    expect(gunzipSync(raw).toString('utf8')).toBe(plainBody);
  });

  test('the SSE team stream stays uncompressed so events flush immediately', async () => {
    const s = bootServer();
    const ctrl = new AbortController();
    const res = await s.app.request(`/api/teams/${s.team.id}/stream`, {
      headers: { 'accept-encoding': 'gzip' },
      signal: ctrl.signal,
    });
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('content-encoding')).toBeNull();
    ctrl.abort();
  });
});
