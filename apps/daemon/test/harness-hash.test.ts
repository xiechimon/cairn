import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { computeHarnessHash } from '../src/harness-hash.js';
import { MachineClient } from '../src/machine-client.js';

describe('#1513 harness fingerprint', () => {
  const material = {
    systemPrompt: 'system',
    skills: [{ name: 'test', content: 'skill body' }],
    tools: [{ name: 'read', description: 'Read files' }],
  };
  test('hashes the complete material with sha256', () => {
    expect(computeHarnessHash(material)).toBe(
      createHash('sha256').update(JSON.stringify(material)).digest('hex'),
    );
  });
  test.each([
    { ...material, systemPrompt: 'changed system' },
    { ...material, skills: [{ name: 'test', content: 'changed skill body' }] },
    { ...material, tools: [{ name: 'read', description: 'changed tool description' }] },
  ])('changes when a harness component changes', (changed) => {
    expect(computeHarnessHash(changed)).not.toBe(computeHarnessHash(material));
  });
  test('ignores incidental discovery order', () => {
    const skills = [...material.skills, { name: 'another', content: 'body' }];
    const tools = [...material.tools, { name: 'bash', description: 'Run commands' }];
    expect(computeHarnessHash({ ...material, skills, tools })).toBe(
      computeHarnessHash({
        ...material,
        skills: [...skills].reverse(),
        tools: [...tools].reverse(),
      }),
    );
  });
});

test('provenance heartbeat carries metadata with a bounded request', async () => {
  const requests: RequestInit[] = [];
  const client = new MachineClient({
    serverUrl: 'http://server',
    fetchImpl: async (_input, init) => {
      requests.push(init ?? {});
      return Response.json({ ok: true });
    },
  });
  const body = { baseSha: 'a'.repeat(40), harnessHash: 'b'.repeat(64) };
  await client.heartbeat('step', body);
  expect(JSON.parse(String(requests[0]?.body))).toEqual(body);
  expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
});
