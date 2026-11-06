import { expect, test } from 'vitest';
import { runGithubEmulatorCase } from './github-emulator-case.js';

test('D109 polls stateful emulate.dev PR/checks and reads review feedback over HTTP', async () => {
  const result = await runGithubEmulatorCase();
  expect(result.open).toMatchObject({
    state: 'open',
    checksPassed: 1,
    checksFailed: 1,
    checksTotal: 2,
  });
  expect(result.feedback.comments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'review', body: 'Please add coverage.' }),
    ]),
  );
  expect(result.feedback.comments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'review-comment', body: 'Explain this change.' }),
    ]),
  );
  expect(result.merged.state).toBe('merged');
  expect(result.unreadable).toBe(1);
});
