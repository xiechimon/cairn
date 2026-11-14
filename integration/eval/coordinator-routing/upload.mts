import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { openDbWithHandle } from '../../../apps/server/src/db/client.js';
import { parseExpectedOutput } from './contract.mts';
import { buildDatasetItem } from './harvest.mts';

const MAX_ITEMS = 60;

export const reviewedFile = z
  .array(z.object({ turnId: z.string().min(1), expectedOutput: z.unknown() }).strict())
  .min(1)
  .max(MAX_ITEMS);

type Db = Parameters<typeof buildDatasetItem>[0];

export function prepareItems(db: Db, teamId: string, raw: unknown, datasetName: string) {
  const reviewed = reviewedFile.parse(raw);
  if (new Set(reviewed.map((r) => r.turnId)).size !== reviewed.length)
    throw new Error('incomplete: duplicate turn in reviewed file');
  return reviewed.map(({ turnId, expectedOutput }) => {
    try {
      const item = buildDatasetItem(db, teamId, turnId, null, datasetName);
      return { ...item, expectedOutput: parseExpectedOutput(expectedOutput, item.input) };
    } catch (error) {
      throw new Error(`${turnId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export interface LangfuseTarget {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

export async function uploadItems(
  items: ReturnType<typeof prepareItems>,
  target: LangfuseTarget,
  send: typeof fetch = fetch,
) {
  const url = `${target.baseUrl.replace(/\/$/, '')}/api/public/dataset-items`;
  const authorization = `Basic ${Buffer.from(`${target.publicKey}:${target.secretKey}`).toString('base64')}`;
  for (const item of items) {
    const response = await send(url, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        datasetName: item.datasetName,
        id: item.id,
        input: item.input,
        expectedOutput: item.expectedOutput,
        sourceTraceId: item.sourceTraceId,
        status: 'ACTIVE',
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${item.id}: Langfuse answered HTTP ${response.status}`);
  }
  return items.length;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const flag = args.indexOf('--dataset');
  const datasetName = flag >= 0 ? (args[flag + 1] ?? '') : 'routing';
  const [dbPath, teamId, reviewedPath] = args.filter(
    (a, n) => !a.startsWith('--') && args[n - 1] !== '--dataset',
  );
  if (!dbPath || !teamId || !reviewedPath || !datasetName) {
    console.error(
      'usage: upload.mts <db-path|-> <team-id> <reviewed.json> [--dataset <name>] [--apply]',
    );
    process.exitCode = 2;
  } else {
    const opened = openDbWithHandle(
      dbPath === '-' ? join(homedir(), '.cairn/server/server.db') : dbPath,
    );
    try {
      const items = prepareItems(
        opened.db,
        teamId,
        JSON.parse(readFileSync(reviewedPath, 'utf8')),
        datasetName,
      );
      for (const item of items) {
        console.log(
          JSON.stringify({
            id: item.id,
            decision: item.expectedOutput.decision,
            parts: item.expectedOutput.parts.length,
          }),
        );
      }
      if (!apply) {
        console.log(`dry run: ${items.length} items valid for dataset ${datasetName}`);
      } else {
        const target = {
          baseUrl: process.env.LANGFUSE_BASE_URL ?? '',
          publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
          secretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
        };
        if (!target.baseUrl || !target.publicKey || !target.secretKey)
          throw new Error(
            'LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required',
          );
        console.log(`uploaded ${await uploadItems(items, target)} items to dataset ${datasetName}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      opened.close();
    }
  }
}
