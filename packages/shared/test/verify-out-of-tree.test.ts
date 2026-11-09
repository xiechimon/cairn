import { expect, test } from 'vitest';
import { buildVerifyStepPrompt, parseVerifyPromptMeta } from '../src/records/verify.js';

const args = {
  ticketRef: '3611',
  taskText: 'Verify the delivery',
  planText: '',
  pr: { number: 7, url: 'https://github.com/example/app/pull/7' },
  expectedHeadSha: 'ab'.repeat(20),
  evidenceStore: 'attachments' as const,
};

test('attachments prompt uploads scratch evidence without changing repository history or the PR', () => {
  const prompt = buildVerifyStepPrompt(args);
  expect(prompt).toContain('.cairn-verify/');
  expect(prompt).toContain('attach_file');
  expect(prompt).toContain('.gif');
  expect(prompt).not.toContain('docs/verify');
  expect(prompt).not.toContain('git add');
  expect(prompt).not.toContain('gh pr edit');
  expect(parseVerifyPromptMeta(prompt)).toMatchObject({
    kind: 'verify',
    expectedHeadSha: args.expectedHeadSha,
    evidence: 'attachments',
    evidenceDirectory: '.cairn-verify/3611/',
  });
});

test('repository prompt remains identical to the legacy default', () => {
  const repository = { ...args, evidenceStore: 'repository' as const };
  const { evidenceStore: _, ...legacy } = repository;
  expect(buildVerifyStepPrompt(repository)).toBe(buildVerifyStepPrompt(legacy));
});
