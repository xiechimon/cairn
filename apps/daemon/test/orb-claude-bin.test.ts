import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { ORB_CLAUDE_BIN, orbBackendFor } from '../src/orb/worker.js';
import { statePaths } from '../src/state.js';
import { testTempDir } from './test-temp-dir.js';

const created = vi.hoisted(() => [] as unknown[]);

vi.mock('../src/backend/claude-code.js', () => ({
  createClaudeCodeBackend: (opts: unknown) => {
    created.push(opts);
    return { opts };
  },
}));

test('the Orb claude-code backend runs the image-pinned claude, not the SDK-bundled lookup', () => {
  const root = testTempDir('orb-claude-bin-');
  const backendFor = orbBackendFor({
    paths: statePaths(join(root, '.cairn'), join(root, 'work')),
    machineName: 'orb',
  });

  backendFor('claude-code');
  backendFor('claude-code');

  expect(ORB_CLAUDE_BIN).toBe('/usr/bin/claude');
  expect(created).toEqual([
    expect.objectContaining({ inOrb: true, executablePath: ORB_CLAUDE_BIN }),
  ]);
});

test('the Orb image build verifies claude at the path the worker pins', () => {
  const recipe = readFileSync(
    join(import.meta.dirname, '../../../scripts/ops/orb/build-image.sh'),
    'utf8',
  );
  expect(recipe).toContain(`runuser -u agent -- ${ORB_CLAUDE_BIN} --version`);
});
