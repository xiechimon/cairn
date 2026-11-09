import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ExperimentClient, openExperimentClient } from '@cairn/shared/langfuse';
import { z } from 'zod';
import { evalCodexKey } from '../../../apps/daemon/src/backend/eval-auth.js';
import { decisionOutput, type ReplayInput, replayInput } from './contract.mts';
import { runSandboxedTurn } from './sandbox.mts';

const manifestSchema = z
  .object({
    dataset: z.string().min(1),
    version: z.iso.datetime(),
    candidateSha: z.string().regex(/^[a-f0-9]{40}$/),
    runnerSha: z.string().regex(/^[a-f0-9]{40}$/),
    promptSha: z.string().regex(/^[a-f0-9]{64}$/),
    evaluatorVersions: z.record(z.string(), z.string()),
    thinking: z.enum(['low', 'medium', 'high']),
    arm: z.enum(['base', 'candidate', 'main']),
    repeat: z.number().int().min(1).max(3),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;
function checkoutSha(cwd: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const fingerprint = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex');
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('incomplete: deadline exceeded')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function runExperiment(
  client: ExperimentClient,
  raw: Manifest,
  execute: (input: ReplayInput) => Promise<unknown>,
) {
  const manifest = manifestSchema.parse(raw);
  const dataset = await within(
    client.dataset.get(manifest.dataset, { version: manifest.version }),
    30_000,
  );
  const items = dataset.items
    .filter((item) => item.status === 'ACTIVE')
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!items.length || items.length > 60 || new Set(items.map((i) => i.id)).size !== items.length)
    throw new Error('incomplete: expected 1..60 distinct active items');
  if (
    items.some((item) => !item.sourceTraceId || !item.datasetId) ||
    new Set(items.map((item) => item.sourceTraceId)).size !== items.length
  )
    throw new Error('incomplete: missing or duplicate harvested provenance');
  const inputs = items.map((item) => replayInput.parse(item.input));
  const hash = fingerprint({
    ...manifest,
    model: 'openai-codex/gpt-6.1-sol',
    items: items.map((i) => i.id),
    inputs,
  });
  const runName = `${manifest.arm}@${manifest.candidateSha.slice(0, 12)}/${hash}/r${manifest.repeat}/${randomUUID()}`;
  const completed = new Set<string>();
  let failed = false;
  const result = await within(
    client.experiment.run({
      name: manifest.dataset,
      runName,
      datasetVersion: manifest.version,
      metadata: { ...manifest, fingerprint: hash, model: 'openai-codex/gpt-6.1-sol' },
      data: items,
      maxConcurrency: 1,
      task: async (item) => {
        if (failed) throw new Error('incomplete: prior item failed');
        try {
          if (!('id' in item) || !items.some((i) => i.id === item.id) || completed.has(item.id))
            throw new Error('Unexpected experiment item');
          const output = decisionOutput.parse(
            await within(execute(replayInput.parse(item.input)), 610_000),
          );
          completed.add(item.id);
          return output;
        } catch {
          failed = true;
          throw new Error('incomplete: Coordinator task failed');
        }
      },
    }),
    items.length * 610_000 + 30_000,
  );
  if (failed || completed.size !== items.length || result.itemResults.length !== items.length)
    throw new Error('incomplete: experiment lost or failed items');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.env.CAIRN_TEST_TEMP_ROOT ??= join(homedir(), '.cache/codex-scratch/eval-langfuse');
  mkdirSync(process.env.CAIRN_TEST_TEMP_ROOT, { recursive: true });
  const deadline = setTimeout(() => process.exit(124), 3_600_000);
  let sdk: ReturnType<typeof openExperimentClient> | undefined;
  try {
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')));
    const checkout = resolve(process.argv[3] ?? '.');
    const sha = checkoutSha(checkout);
    if (sha !== manifest.candidateSha) throw new Error('Candidate head changed');
    for (const cwd of [checkout, resolve(import.meta.dirname, '../../..')]) {
      const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd,
        encoding: 'utf8',
      });
      const ignored = execFileSync(
        'git',
        [
          'ls-files',
          '--others',
          '--ignored',
          '--exclude-standard',
          '--',
          '.',
          ':!:node_modules/**',
          ':!:**/node_modules/**',
        ],
        { cwd, encoding: 'utf8' },
      );
      if (dirty.trim() || ignored.trim())
        throw new Error('Checkouts must contain only clean public sources and dependencies');
    }
    const runnerSha = checkoutSha(resolve(import.meta.dirname, '../../..'));
    const promptSha = createHash('sha256')
      .update(readFileSync(join(checkout, 'apps/server/src/services/chief.ts')))
      .digest('hex');
    if (runnerSha !== manifest.runnerSha || promptSha !== manifest.promptSha)
      throw new Error('Runner or prompt source changed');
    const key = await within(
      evalCodexKey(
        process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.cairn/agent-runtime'),
        AbortSignal.timeout(30_000),
      ),
      30_000,
    );
    sdk = openExperimentClient({
      baseUrl: process.env.LANGFUSE_BASE_URL ?? '',
      publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
      secretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
    });
    const result = await runExperiment(sdk.client, manifest, (input) =>
      runSandboxedTurn(
        input,
        {
          kind: 'http',
          providerId: 'openai-codex',
          api: 'openai-responses',
          models: [{ id: 'gpt-6.1-sol', name: 'Codex' }],
        },
        key,
        600_000,
        manifest.thinking,
        checkout,
      ),
    );
    await within(sdk.close(), 15_000);
    console.log(
      JSON.stringify({
        runName: result.runName,
        experimentId: result.experimentId,
        items: result.itemResults.length,
      }),
    );
  } catch {
    console.error('incomplete: experiment did not finish');
    process.exitCode = 1;
  } finally {
    if (sdk)
      await within(sdk.close(), 15_000).catch(() => {
        process.exitCode = 1;
      });
    clearTimeout(deadline);
    process.exit(process.exitCode ?? 0);
  }
}
