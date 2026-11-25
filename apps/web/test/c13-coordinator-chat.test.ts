import {
  COORDINATOR_NOT_READY,
  type ChiefGetResponse,
  type ChiefThread,
  SUBAGENT_TOOL_NAME,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { AttachmentError } from '../src/api/attachments.js';
import { ApiError } from '../src/api/client.js';
import { type MessageRow, mapChief, mapChiefStream } from '../src/api/mappers.js';
import type { OutboxEntry } from '../src/chief/outbox.js';
import { failedOutboxForChannel } from '../src/chief/outbox.js';
import { chiefActionErrorCopy } from '../src/chief/use-chief-surface.js';
import { attachmentFailureTitle } from '../src/overlay/attachment-paste.js';

const NOW = 1_758_000_000_000;

const ENV = {
  chief: {
    id: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    agent: { agentId: 'agent-1' },
    lastTurnAt: null,
    createdAt: 0,
    tz: null,
    model: null,
  },
  agentActor: null,
  context: null,
  watches: [],
  wakes: [],
} as unknown as ChiefGetResponse;

const THREAD: ChiefThread = {
  id: 'chief-sub',
  chiefId: 'chief-u1-t1',
  userId: 'u1',
  teamId: 't1',
  title: 'Coordinator',
  createdAt: 1,
  updatedAt: 1,
  lastTurnAt: null,
  session: { runtime: 'pi', id: 's1', openedAt: 1 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: { phase: 'chief', tool: { toolName: SUBAGENT_TOOL_NAME } },
};

function makeEntry(overrides: Partial<OutboxEntry>): OutboxEntry {
  return {
    key: 'k1',
    scope: 'u1/t1',
    threadId: null,
    projectId: null,
    text: 'hello',
    state: 'failed',
    messageId: null,
    createdAt: NOW,
    ...overrides,
  };
}

describe('C13: failed outbox isolation across channels', () => {
  test('never leaks a failed entry from project A into project B when both have null threadId', () => {
    const entries = [
      makeEntry({ key: 'a', threadId: null, projectId: 'proj-a', text: 'for A' }),
      makeEntry({ key: 'b', threadId: 'thread-a', projectId: 'proj-a', text: 'for thread A' }),
    ];
    expect(failedOutboxForChannel(entries, null, 'proj-b')).toEqual([]);
    expect(failedOutboxForChannel(entries, 'thread-b', 'proj-b')).toEqual([]);
    expect(failedOutboxForChannel(entries, null, null)).toEqual([]);
    expect(failedOutboxForChannel(entries, null, 'proj-a').map((e) => e.key)).toEqual(['a']);
    expect(failedOutboxForChannel(entries, 'thread-a', 'proj-a').map((e) => e.key)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('C13: subagent live progress and terminal status mapping', () => {
  test('maps live subagent progress with label, toolCalls, lastTool, and running status', () => {
    const chief = mapChief(ENV, {
      threads: [THREAD],
      activeThreadId: 'chief-sub',
      messages: [
        { id: 'u1', role: 'user', content: 'Check logs', createdAt: NOW } as MessageRow,
        {
          id: 'm1',
          role: 'assistant',
          content: {
            kind: 'toolcall',
            call: {
              id: 'c1',
              name: SUBAGENT_TOOL_NAME,
              arguments: { task: 'Check task #11', label: '检查 #11' },
              startedAt: NOW,
              result: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    status: 'running',
                    label: '检查 #11',
                    childId: 'child-1',
                    toolCalls: 3,
                    lastTool: 'search_history',
                    startedAt: NOW,
                    elapsedMs: 12_000,
                  }),
                },
              ],
            },
          },
          createdAt: NOW,
        } as MessageRow,
      ],
    });
    const streaming = chief.stream?.find((item) => item.kind === 'streaming');
    expect(streaming?.kind).toBe('streaming');
    const tool = streaming?.kind === 'streaming' ? streaming.tools?.[0] : undefined;
    expect(tool?.running).toBe(true);
    expect(tool?.subagent).toEqual({
      label: '检查 #11',
      status: 'running',
      toolCalls: 3,
      lastTool: 'search_history',
      durationMs: 12_000,
    });
  });

  test('maps terminal subagent statuses (completed, timed_out, failed, aborted)', () => {
    const makeTerminal = (id: string, status: string, label: string, toolCalls: number) =>
      ({
        id,
        role: 'assistant',
        content: {
          kind: 'toolcall',
          call: {
            id: `c-${id}`,
            name: SUBAGENT_TOOL_NAME,
            arguments: { task: label, label },
            startedAt: NOW,
            endedAt: NOW + 5_000,
            isError: status === 'failed',
            result: [
              {
                type: 'text',
                text: JSON.stringify({
                  status,
                  summary: 'done',
                  childId: `ch-${id}`,
                  runtime: 'pi',
                  model: 'stub/m',
                  toolCalls,
                  durationMs: 5_000,
                  usage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                  },
                  label,
                }),
              },
            ],
          },
        },
        createdAt: NOW,
      }) as MessageRow;

    const stream = mapChiefStream([
      { id: 'u1', role: 'user', content: 'Check 4 items', createdAt: NOW } as MessageRow,
      makeTerminal('m1', 'completed', '检查 A', 2),
      makeTerminal('m2', 'timed_out', '检查 B', 4),
      makeTerminal('m3', 'failed', '检查 C', 1),
      makeTerminal('m4', 'aborted', '检查 D', 0),
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: '汇总完成。' }],
        createdAt: NOW + 6_000,
      } as MessageRow,
    ]);

    const reply = stream.find((item) => item.kind === 'robot');
    const statuses =
      reply?.kind === 'robot'
        ? reply.tools?.map((t) => ({
            label: t.subagent?.label,
            status: t.subagent?.status,
            toolCalls: t.subagent?.toolCalls,
          }))
        : [];
    expect(statuses).toEqual([
      { label: '检查 A', status: 'completed', toolCalls: 2 },
      { label: '检查 B', status: 'timed_out', toolCalls: 4 },
      { label: '检查 C', status: 'failed', toolCalls: 1 },
      { label: '检查 D', status: 'aborted', toolCalls: 0 },
    ]);
  });
});

describe('C13: specific error copy for expired approval, missing model, and attachment quota', () => {
  test('distinguishes expired approval and missing model', () => {
    const expired = chiefActionErrorCopy(
      new ApiError(409, 'proposal prop-1 expired'),
      'answer',
      'approval-prop-1',
    );
    expect(expired?.title).toContain('过期');

    const noModel = chiefActionErrorCopy(
      new ApiError(409, 'coordinator routing rule has no model configured', COORDINATOR_NOT_READY),
      'rewind',
    );
    expect(noModel?.kind).toBe('not-ready');
  });

  test('distinguishes attachment quota error', () => {
    expect(attachmentFailureTitle(new AttachmentError('quota', 'quota exceeded'))).toBe(
      '团队附件空间已满',
    );
  });
});
