import { afterEach, describe, expect, test } from 'vitest';
import { runPilot } from './pilot.js';

const saved = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('EVAL_ARM_')) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

describe('calibration pilot', () => {
  test(
    'runs A/A and a sabotaged arm inside the approved cap and reports the gap honestly',
    { timeout: 180_000 },
    async () => {
      for (const key of Object.keys(process.env)) {
        if (key.startsWith('EVAL_ARM_')) delete process.env[key];
      }
      const result = await runPilot();
      expect(result.mode).toBe('scripted');
      expect(result.starts).toBeLessThanOrEqual(result.cap.maxStarts);
      expect(result.arms[0]).toMatchObject({ arm: 'none', passed: 3, graded: 3 });
      expect(result.arms[1]).toMatchObject({ arm: 'none', passed: 3, graded: 3 });
      expect(result.arms[2]).toMatchObject({ arm: 'nopatch', passed: 0, graded: 3 });
      expect(result.aaDiscordance).toBe(0);
      expect(result.damage.kind).toBe('discard');
      expect(result.capProof).toMatchObject({ admitted: 64, attempted: 65 });
      expect(result.missing).toContain('EVAL_ARM_MODEL');
      expect(result.power.atReference).toBeCloseTo(0.36, 2);
    },
  );
});
