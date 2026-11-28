import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import type { PilotResult } from './pilot.js';
import { renderScorecard, writeScorecard } from './scorecard.js';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const decision = (kind: 'keep' | 'discard' | 'invalid') => ({
  kind,
  n: 4,
  wins: kind === 'keep' ? 4 : 0,
  losses: 0,
  ties: kind === 'keep' ? 0 : 4,
  effect: kind === 'keep' ? 1 : 0,
  p: kind === 'keep' ? 0.0625 : 1,
  reason: 'fixture reason',
});

const result: PilotResult = {
  topic: 'harness-self-improve',
  mode: 'scripted',
  model: 'stub/m',
  startedAt: '2026-11-29T00:00:00.000Z',
  finishedAt: '2026-11-29T00:05:00.000Z',
  wallMs: 300_000,
  cap: { maxStarts: 64, maxWallMinutes: 30 },
  starts: 9,
  stopReason: 'wall cap 30 minutes reached',
  capProof: { attempted: 65, admitted: 64, refused: 'start cap 64 reached' },
  cases: 3,
  arms: [{ arm: 'none', passed: 3, graded: 3 }],
  launches: [
    { caseId: 'pilot-sum', arm: 'none', wallMs: 30_000, passed: true, exitCode: 0 },
    { caseId: 'pilot-sum', arm: 'none', wallMs: 31_000, passed: true, exitCode: 0 },
  ],
  aa: decision('discard'),
  damage: decision('discard'),
  aaDiscordance: 0,
  power: {
    targetPoints: 30,
    confirmationPairs: 24,
    atReference: 0.36,
    scenarios: [{ pairs: 24, discordance: 1, candidateShare: 0.65, power: 0.36 }],
    reach80: { pairs: 40, discordance: 1 },
  },
  conclusion: 'Machinery only.',
  missing: 'A real-model A/A needs the approved model behind EVAL_ARM_BASE_URL.',
  incomplete: null,
};

describe('scorecard', () => {
  test('reads as an operator page: verdict, stop reason and the power gap', () => {
    const html = renderScorecard(result);
    expect(html).toContain('calibration scorecard');
    expect(html).toContain('wall cap 30 minutes reached');
    expect(html).toContain('36.0%');
    expect(html).toContain('A/A (same policy twice)');
    expect(html).not.toMatch(/EVAL_ARM_API_KEY/);
  });

  test('is written owner-only and outside any served directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scorecard-'));
    dirs.push(dir);
    const path = writeScorecard(join(dir, 'scorecard.html'), result);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(readFileSync(path, 'utf8')).toContain('Harness self-improvement');
  });

  test('an incomplete arm is shown as inconclusive, never as a verdict', () => {
    const html = renderScorecard({
      ...result,
      incomplete: 'arm incomplete: the cap refused 2 reservations',
    });
    expect(html).toContain('Inconclusive');
    expect(html).toContain('the cap refused 2 reservations');
  });

  test('escapes text it prints', () => {
    const hostile = { ...result, stopReason: '<script>alert(1)</script>' };
    expect(renderScorecard(hostile)).not.toContain('<script>alert(1)</script>');
    expect(renderScorecard(hostile)).toContain('&lt;script&gt;');
  });
});
