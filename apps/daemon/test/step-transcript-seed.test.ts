import {
  gitCredentialRowContent,
  transcriptPromptRowId,
  type WorkspaceHookNoteData,
  workspaceHookRowContent,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import type { TranscriptMessage } from '../src/journal.js';
import { type StepTranscriptSeed, seedStepTranscript } from '../src/step-transcript-seed.js';

const hook = (name: 'setup' | 'resume', output: string): WorkspaceHookNoteData => ({
  name,
  status: 'ok',
  exitCode: 0,
  output,
  totalChars: output.length,
  ms: 1,
});

function seeded(overrides: Partial<StepTranscriptSeed>): TranscriptMessage[] {
  const rows: TranscriptMessage[] = [];
  seedStepTranscript(
    { upsert: (row) => rows.push(row) },
    {
      stepId: 's1',
      now: () => 500,
      modelKey: 'm',
      skippedNoVisionCount: 0,
      prompt: null,
      workspaceHooks: [],
      gitCredentialSource: null,
      redact: (text) => text,
      ...overrides,
    },
  );
  return rows;
}

describe('seedStepTranscript', () => {
  test('nothing to seed writes no rows', () => {
    expect(seeded({})).toEqual([]);
  });

  test('rows come in order: image skip, prompt, workspace hooks, git credential', () => {
    const ws = hook('resume', 'ok');
    const rows = seeded({
      skippedNoVisionCount: 2,
      prompt: 'do it',
      workspaceHooks: [ws],
      gitCredentialSource: 'machine',
    });
    expect(rows.map((r) => r.id)).toEqual([
      'image-skip-s1',
      transcriptPromptRowId('s1'),
      'hook-resume-s1',
      'git-credential-s1',
    ]);
    expect(rows[1]).toMatchObject({ role: 'user', content: 'do it' });
    expect(rows[2]?.content).toBe(workspaceHookRowContent(ws, 'ok'));
    expect(rows[3]?.content).toBe(gitCredentialRowContent('machine'));
  });

  test('hook output is redacted before it is written', () => {
    const rows = seeded({
      workspaceHooks: [hook('setup', 'token=abc')],
      redact: (text) => text.replace('abc', '***'),
    });
    expect(rows[0]?.content).toBe(workspaceHookRowContent(hook('setup', 'token=abc'), 'token=***'));
  });
});
