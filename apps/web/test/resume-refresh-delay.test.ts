import { describe, expect, test } from 'vitest';
import { resumeRefreshDelayMs } from '../src/api/resume-refresh-delay.js';

describe('resumeRefreshDelayMs', () => {
  test('uses the server-relative remaining ms when positive', () => {
    expect(resumeRefreshDelayMs(12_345)).toBe(12_345);
  });

  test('backs off when the remaining ms is already zero', () => {
    expect(resumeRefreshDelayMs(0)).toBe(1_000);
  });
});
