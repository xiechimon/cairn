import type { TaskRequest } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { threadOrigin, threadUpdates } from '../src/board/thread-panel-model.js';

describe('threadUpdates', () => {
  test('returns null outside waiting/review phases', () => {
    expect(
      threadUpdates({ phase: 'building', phaseAt: 100 }, [
        { kind: 'verify', passed: true, conclusion: 'All checks passed', evidence: [], createdAt: 200 },
      ]),
    ).toBeNull();
    expect(
      threadUpdates({ phase: 'done', phaseAt: 100 }, [
        { kind: 'robot', markdown: 'Finished.', createdAt: 200 },
      ]),
    ).toBeNull();
  });

  test('collects pending questions, verify/review/report lines and latest timestamp in review phase', () => {
    const result = threadUpdates({ phase: 'review', phaseAt: 100 }, [
      {
        kind: 'question',
        id: 'question-1',
        requestId: 'request-1',
        status: 'pending',
        questions: [{ header: 'Auth', question: 'Keep cookie auth?', options: [] }],
        answers: null,
      },
      { kind: 'verify', passed: true, conclusion: 'Tests passed', evidence: [], createdAt: 300 },
      { kind: 'review', conclusion: 'Looks clean', findings: [], createdAt: 250 },
    ]);
    expect(result).toEqual({
      lines: ['Keep cookie auth?', 'Tests passed', 'Looks clean'],
      at: 300,
    });
  });

  test('falls back to latest robot first line in review phase when no summary rows exist', () => {
    const result = threadUpdates({ phase: 'review', phaseAt: 100 }, [
      { kind: 'robot', markdown: '## Summary\nDetails here', createdAt: 420 },
    ]);
    expect(result).toEqual({ lines: ['Summary'], at: 420 });
  });

  test('returns null for a review info task owned by Coordinator', () => {
    expect(
      threadUpdates(
        { phase: 'review', phaseAt: 100, output: 'info', owner: 'coordinator', section: 'working' },
        [
          { kind: 'report', id: 'r1', markdown: '# Exported\nOK', createdAt: 200 },
          { kind: 'robot', markdown: 'Done.', createdAt: 300 },
        ],
      ),
    ).toBeNull();
  });
});

describe('threadOrigin', () => {
  test('resolves matching owner chat segment and timestamp from the stream', () => {
    const request: TaskRequest = {
      siblings: [],
      difficulty: null,
      titleSource: 'owner',
      titleSourceRef: null,
      segments: [
        {
          text: 'Inspect login traces',
          author: 'owner',
          sourceRef: null,
          source: { kind: 'chat', threadId: 'chief-1', messageId: 'msg-1', span: 'whole' },
        },
      ],
    };
    const origin = threadOrigin(request, {
      items: [{ kind: 'user', id: 'msg-1', text: 'Inspect login traces', createdAt: 555 }],
      at: [555],
    });
    expect(origin).toEqual({ messageId: 'msg-1', text: 'Inspect login traces', at: 555 });
  });

  test('returns null timestamp when originating message is not loaded in stream', () => {
    const request: TaskRequest = {
      siblings: [],
      difficulty: null,
      titleSource: 'owner',
      titleSourceRef: null,
      segments: [
        {
          text: 'Inspect login traces',
          author: 'owner',
          sourceRef: null,
          source: { kind: 'chat', threadId: 'chief-1', messageId: 'msg-missing', span: 'whole' },
        },
      ],
    };
    expect(threadOrigin(request, { items: [], at: [] })).toEqual({
      messageId: 'msg-missing',
      text: 'Inspect login traces',
      at: null,
    });
  });
});
