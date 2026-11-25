import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { localRunnerHome } from '../src/runner-home.js';

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function homes() {
  const root = mkdtempSync(join(tmpdir(), 'cairn-local-runner-home-'));
  scratch.push(root);
  const shared = join(root, '.cairn');
  mkdirSync(shared);
  return { shared, isolated: join(root, 'user-data', 'runner-home') };
}

function enrolled(home: string, serverUrl: string): string {
  const body = `${JSON.stringify({ machineId: 'm1', token: 'a'.repeat(64), teamId: 't1', serverUrl })}\n`;
  writeFileSync(join(home, 'machine.json'), body);
  return body;
}

describe('the desktop runner home next to another Cairn runner', () => {
  test('leaves a registration for another server untouched and runs in its own home', () => {
    const { shared, isolated } = homes();
    const other = enrolled(shared, 'http://127.0.0.1:8787');
    expect(localRunnerHome(shared, isolated, 'http://127.0.0.1:60805')).toBe(isolated);
    expect(readFileSync(join(shared, 'machine.json'), 'utf8')).toBe(other);
  });

  test('keeps the shared home when it is empty or already registered to this server', () => {
    const { shared, isolated } = homes();
    expect(localRunnerHome(shared, isolated, 'http://127.0.0.1:60805')).toBe(shared);
    enrolled(shared, 'http://127.0.0.1:60805');
    expect(localRunnerHome(shared, isolated, 'http://127.0.0.1:60805')).toBe(shared);
  });
});
