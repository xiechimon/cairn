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
      orbHookNotes: [],
      orbStartedAt: undefined,
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

  test('rows come in order: image skip, prompt, orb notes, workspace hooks, git credential', () => {
    const orb = hook('setup', 'orb: started in 0ms');
    const ws = hook('resume', 'ok');
    const rows = seeded({
      skippedNoVisionCount: 2,
      prompt: 'do it',
      orbHookNotes: [orb],
      orbStartedAt: 200,
      workspaceHooks: [ws],
      gitCredentialSource: 'machine',
    });
    expect(rows.map((r) => r.id)).toEqual([
      'image-skip-s1',
      transcriptPromptRowId('s1'),
      'orb-hook-0-s1',
      'hook-resume-s1',
      'git-credential-s1',
    ]);
    expect(rows[1]).toMatchObject({ role: 'user', content: 'do it' });
    expect(rows[2]?.content).toBe(workspaceHookRowContent(orb, 'orb: started in 300ms'));
    expect(rows[4]?.content).toBe(gitCredentialRowContent('machine'));
  });

  test('hook output is redacted before it is written', () => {
    const rows = seeded({
      workspaceHooks: [hook('setup', 'token=abc')],
      redact: (text) => text.replace('abc', '***'),
    });
    expect(rows[0]?.content).toBe(workspaceHookRowContent(hook('setup', 'token=abc'), 'token=***'));
  });

  test('an orb note keeps its own output when no start time is known', () => {
    const orb = hook('setup', 'orb: started in 7ms');
    const rows = seeded({ orbHookNotes: [orb] });
    expect(rows[0]?.content).toBe(workspaceHookRowContent(orb, 'orb: started in 7ms'));
  });
});
