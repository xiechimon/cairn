import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RemoteToolDef } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { stepRemoteToolExecutor, type VerifyEvidenceUploads } from '../src/step-remote-tools.js';
import { testTempDir } from './test-temp-dir.js';

interface Relayed {
  name: string;
  params: Record<string, unknown>;
  opts: { replaySafe?: boolean } | undefined;
}

function harness(opts: {
  attachFiles?: boolean;
  askAvailable?: boolean;
  verifyEvidence?: VerifyEvidenceUploads | null;
  reply?: (params: Record<string, unknown>) => string;
}) {
  const cwd = realpathSync(testTempDir('cairn-remote-tools-'));
  const relayed: Relayed[] = [];
  const asked: Record<string, unknown>[] = [];
  const remoteTools = [
    { name: 'search_memory', replaySafe: true },
    { name: 'send_message' },
  ] as unknown as RemoteToolDef[];
  const execute = stepRemoteToolExecutor({
    client: {
      relayTool: async (_stepId, name, params, relayOpts) => {
        relayed.push({ name, params, opts: relayOpts });
        return opts.reply?.(params) ?? 'ok';
      },
    },
    stepId: 's1',
    cwd,
    remoteTools,
    askChannel: {
      available: opts.askAvailable ?? false,
      ask: async (params) => {
        asked.push(params);
        return 'answered';
      },
    },
    attachFiles: opts.attachFiles ?? true,
    verifyEvidence: opts.verifyEvidence ?? null,
  });
  return { cwd, execute, relayed, asked };
}

describe('stepRemoteToolExecutor', () => {
  test('ask_user goes to the ask channel while it is available', async () => {
    const h = harness({ askAvailable: true });
    expect(await h.execute('ask_user', { question: 'Which?' })).toBe('answered');
    expect(h.asked).toEqual([{ question: 'Which?' }]);
    expect(h.relayed).toEqual([]);
  });

  test('ask_user is relayed when the ask channel is unavailable', async () => {
    const h = harness({ askAvailable: false });
    await h.execute('ask_user', { question: 'Which?' });
    expect(h.relayed.map((r) => r.name)).toEqual(['ask_user']);
  });

  test('replay-safe tools are relayed with the flag and others without it', async () => {
    const h = harness({});
    await h.execute('search_memory', { q: 'x' });
    await h.execute('send_message', { text: 'hi' });
    expect(h.relayed.map((r) => r.opts)).toEqual([{ replaySafe: true }, {}]);
  });

  test('attach_file uploads the file content when attachments are allowed', async () => {
    const h = harness({});
    writeFileSync(join(h.cwd, 'shot.txt'), 'hello');
    await h.execute('attach_file', { path: 'shot.txt' });
    expect(h.relayed[0]?.params.contentBase64).toBe(Buffer.from('hello').toString('base64'));
  });

  test('attach_file is relayed unchanged when attachments are not allowed', async () => {
    const h = harness({ attachFiles: false });
    await h.execute('attach_file', { path: 'shot.txt' });
    expect(h.relayed[0]?.params).toEqual({ path: 'shot.txt' });
  });

  test('verify evidence records an upload only when the server echoes its sha256', async () => {
    const uploaded = new Set<string>();
    const sha = createHash('sha256').update('proof').digest('hex');
    const h = harness({
      verifyEvidence: { directory: 'evidence', uploaded },
      reply: () => JSON.stringify({ id: 'a1', sha256: uploaded.size === 0 ? sha : 'wrong' }),
    });
    mkdirSync(join(h.cwd, 'evidence'));
    writeFileSync(join(h.cwd, 'evidence', 'good.txt'), 'proof');
    writeFileSync(join(h.cwd, 'evidence', 'bad.txt'), 'proof');
    await h.execute('attach_file', { path: 'evidence/good.txt' });
    await expect(h.execute('attach_file', { path: 'evidence/bad.txt' })).rejects.toThrow();
    expect([...uploaded]).toEqual([join(h.cwd, 'evidence', 'good.txt')]);
  });
});
