import type { BuildRecord, StepQueueInfo } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type StepRow } from '../src/api/hooks.js';
import { mapTranscript } from '../src/api/mappers.js';
import { EN } from '../src/i18n/en.js';
import { translate } from '../src/i18n/translate.js';
import { NOW, todo } from './helpers.js';

function pendingStep(queue: StepQueueInfo): StepRow {
  return {
    id: 'step-push-ui',
    buildId: 'build-push-ui',
    kind: 'build',
    machineId: null,
    status: 'pending',
    checkpointCommit: null,
    skillInjection: null,
    createdAt: NOW - 10_000,
    queue,
  };
}

const BUILD: BuildRecord = {
  id: 'build-push-ui',
  todoId: 'todo-1',
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: NOW - 10_000,
};

describe('github-push-missing queue copy', () => {
  test('named runner renders computer name and gh auth login instruction in zh and en', () => {
    const items = mapTranscript({
      messages: [],
      steps: [
        pendingStep({
          position: 1,
          waitingFor: { machineId: 'm1', name: 'mac-mini' },
          blocked: { kind: 'github-push-missing', missing: [] },
        }),
      ],
      build: BUILD,
      todo: todo(1, 'queued'),
      machineName: 'mac-mini',
      userName: 'ian',
      liveText: '',
    });
    const streaming = items.find((item) => item.kind === 'streaming');
    expect(streaming).toBeDefined();
    if (streaming?.kind !== 'streaming') return;
    expect(streaming.blocked).toBe(true);
    expect(streaming.blockedKind).toBe('github-push-missing');
    const zh = translate('zh', EN, streaming.label, streaming.labelVars);
    const en = translate('en', EN, streaming.label, streaming.labelVars);
    expect(zh).toContain('mac-mini');
    expect(zh).toContain('gh auth login');
    expect(en).toContain('mac-mini');
    expect(en).toContain('gh auth login');
  });

  test('unnamed multi-runner pool renders plain fallback copy in zh and en', () => {
    const items = mapTranscript({
      messages: [],
      steps: [
        pendingStep({
          position: 1,
          waitingFor: null,
          blocked: { kind: 'github-push-missing', missing: [] },
        }),
      ],
      build: BUILD,
      todo: todo(1, 'queued'),
      machineName: null,
      userName: 'ian',
      liveText: '',
    });
    const streaming = items.find((item) => item.kind === 'streaming');
    expect(streaming).toBeDefined();
    if (streaming?.kind !== 'streaming') return;
    expect(streaming.blocked).toBe(true);
    expect(streaming.blockedKind).toBe('github-push-missing');
    const zh = translate('zh', EN, streaming.label, streaming.labelVars);
    const en = translate('en', EN, streaming.label, streaming.labelVars);
    expect(zh).toContain('gh auth login');
    expect(en).toContain('gh auth login');
  });
});
