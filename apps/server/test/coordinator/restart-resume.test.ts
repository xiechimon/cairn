import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';

const dirs: string[] = [];
const children: { kill: (signal?: NodeJS.Signals | number) => boolean }[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

const TSX = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
const PROBE = fileURLToPath(new URL('../restart-probe.mjs', import.meta.url));

function runProbe(
  dir: string,
  mode: 'hold' | 'resume',
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX, PROBE, dir, mode], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      resolve({ code, output });
    });
  });
}

function checkpoint(dir: string): void {
  const db = new DatabaseSync(join(dir, 'thread-restart.sqlite'));
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}

function generation(dir: string): { status: string; record: string } | undefined {
  try {
    return readGeneration(dir);
  } catch {
    return undefined;
  }
}

function readGeneration(dir: string): { status: string; record: string } | undefined {
  const db = new DatabaseSync(join(dir, 'thread-restart.sqlite'), { readOnly: true });
  const row = db
    .prepare('select status, record from tasks where kind = \'"pi.generation"\'')
    .get() as { status: string; record: string } | undefined;
  db.close();
  return row;
}

describe('a Coordinator turn resumed after the server restarts', () => {
  it('registers the thread provider before the interrupted generation looks its model up', async () => {
    const dir = makeTestTempDir('coord-restart-');
    dirs.push(dir);
    const held = runProbe(dir, 'hold');
    const holderOutput = held
      .then((result) => result.output)
      .catch((error: unknown) => String(error));
    const started = Date.now();
    let row = generation(dir);
    while (row === undefined || !row.record.includes('"phase":"request"')) {
      if (Date.now() - started > 8_000) {
        throw new Error(
          `the held turn never reached the model request: ${row?.record ?? 'no store'}\n${await holderOutput}`,
        );
      }
      try {
        row = generation(dir);
      } catch {
        row = undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    checkpoint(dir);
    const holder = children[0];
    if (holder === undefined) throw new Error('the holding process already exited');
    holder.kill('SIGKILL');
    await held;

    const resumed = await runProbe(dir, 'resume');
    const finished = generation(dir);
    expect(`${resumed.output}\n${finished?.record ?? ''}`).not.toContain('no_model');
    expect(finished?.record ?? '').not.toContain('is not available');
  }, 60_000);
});
