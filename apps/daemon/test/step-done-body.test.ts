import { describe, expect, test } from 'vitest';
import type { TranscriptMessage } from '../src/journal.js';
import {
  composeDoneBody,
  type StepDoneOutcome,
  type StepVerdictSource,
} from '../src/step-done-body.js';

const outcome: StepDoneOutcome = {
  status: 'success',
  lastError: null,
  sessionId: null,
  usage: [],
  hasChanges: false,
  headCommit: null,
  preservedCommits: [],
  pushHookOutput: null,
  prProbe: null,
  changesDiff: null,
  branchDrift: null,
  quotaBlock: null,
  skillInjectionFacts: null,
  report: null,
};

const assistant = (content: string) =>
  ({ id: 'a', role: 'assistant', content, createdAt: 1 }) as TranscriptMessage;

const source = (overrides: Partial<StepVerdictSource>): StepVerdictSource => ({
  kind: 'build',
  messages: [assistant('done')],
  attachmentVerify: false,
  uploadedEvidence: new Set(),
  cwd: '/wt',
  ...overrides,
});

const verdictJson = (passed: boolean) =>
  `\`\`\`json\n${JSON.stringify({
    passed,
    conclusion: 'ok',
    evidence: [{ path: 'shots/a.png', note: 'a' }],
  })}\n\`\`\``;

describe('composeDoneBody', () => {
  test('omits every absent field', () => {
    expect(composeDoneBody(outcome, source({}))).toEqual({
      status: 'success',
      usage: [],
      hasChanges: false,
    });
  });

  test('carries the step outputs and strips ANSI from the error', () => {
    const body = composeDoneBody(
      {
        ...outcome,
        status: 'failed',
        lastError: '\u001b[31mboom\u001b[0m',
        sessionId: 's1',
        headCommit: 'c1',
        preservedCommits: ['a'.repeat(40)],
        prProbe: { number: 7, url: 'https://example.test/pr/7' },
        branchDrift: { expected: 'x', actual: 'y' },
        report: '# r',
      },
      source({}),
    );
    expect(body).toMatchObject({
      status: 'failed',
      errorMessage: 'boom',
      sessionId: 's1',
      commit: 'c1',
      preservedCommits: ['a'.repeat(40)],
      prUrl: 'https://example.test/pr/7',
      prNumber: 7,
      workBranchDrift: { expected: 'x', actual: 'y' },
      report: '# r',
    });
  });

  test('marks a successful step without assistant output', () => {
    expect(composeDoneBody(outcome, source({ messages: [] })).noOutput).toBe(true);
    expect(
      composeDoneBody({ ...outcome, status: 'failed' }, source({ messages: [] })).noOutput,
    ).toBeUndefined();
  });

  test('reports a review step without a verdict as a findings error', () => {
    const body = composeDoneBody(outcome, source({ kind: 'review' }));
    expect(body.findings).toBeUndefined();
    expect(typeof body.findingsError).toBe('string');
  });

  test('fails an attachment verify verdict whose evidence was not uploaded', () => {
    const messages = [assistant(verdictJson(true))];
    const plain = composeDoneBody(outcome, source({ kind: 'verify', messages }));
    expect(plain.verifyVerdict?.passed).toBe(true);
    const strict = composeDoneBody(
      outcome,
      source({ kind: 'verify', messages, attachmentVerify: true }),
    );
    expect(strict.verifyVerdict?.passed).toBe(false);
    const uploaded = composeDoneBody(
      outcome,
      source({
        kind: 'verify',
        messages,
        attachmentVerify: true,
        uploadedEvidence: new Set(['/wt/shots/a.png']),
      }),
    );
    expect(uploaded.verifyVerdict?.passed).toBe(true);
  });
});
