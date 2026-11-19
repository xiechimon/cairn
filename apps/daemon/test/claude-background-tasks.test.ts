import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, test } from 'vitest';
import { BackgroundTaskRows } from '../src/backend/claude-background-tasks.js';

function frame(subtype: string, fields: Record<string, unknown>): SDKMessage {
  return {
    type: 'system',
    subtype,
    uuid: 'u',
    session_id: 's',
    ...fields,
  } as unknown as SDKMessage;
}

function rows() {
  let t = 1_000;
  return new BackgroundTaskRows(() => (t += 10));
}

describe('background task rows (docs/design/task-panel-live-row-subagents-todo.md B)', () => {
  test('a background agent keeps its spawning tool call and moves running -> done with its counts', () => {
    const r = rows();
    const started = r.note(
      frame('task_started', {
        task_id: 'a1',
        tool_use_id: 'toolu_spawn',
        task_type: 'local_agent',
        description: 'count files',
        prompt: 'ls and count',
        is_backgrounded: true,
      }),
    );
    expect(started).toEqual([
      expect.objectContaining({
        taskId: 'a1',
        toolCallId: 'toolu_spawn',
        type: 'agent',
        status: 'running',
        prompt: 'ls and count',
      }),
    ]);
    expect(
      r.note(
        frame('task_progress', {
          task_id: 'a1',
          usage: { total_tokens: 900, tool_uses: 2, duration_ms: 5 },
        }),
      ),
    ).toEqual([expect.objectContaining({ status: 'running', toolUses: 2, tokens: 900 })]);
    const done = r.note(
      frame('task_notification', {
        task_id: 'a1',
        status: 'completed',
        summary: '7 entries',
        output_file: '/x',
      }),
    );
    expect(done).toEqual([expect.objectContaining({ status: 'done', summary: '7 entries' })]);
    expect(done[0]?.endedAt).toBeGreaterThan(started[0]!.startedAt);
    expect(r.running).toEqual([]);
  });

  test('a background shell is tracked; failed and stopped map to their own status', () => {
    const r = rows();
    r.note(
      frame('task_started', { task_id: 'b1', task_type: 'local_bash', description: 'sleep 20' }),
    );
    r.note(
      frame('task_started', { task_id: 'b2', task_type: 'local_bash', description: 'npm run dev' }),
    );
    expect(r.note(frame('task_notification', { task_id: 'b1', status: 'failed' }))[0]?.status).toBe(
      'failed',
    );
    expect(
      r.note(frame('task_updated', { task_id: 'b2', patch: { status: 'killed' } }))[0]?.status,
    ).toBe('stopped');
  });

  test('a foreground agent shows no row until it is moved to the background', () => {
    const r = rows();
    expect(
      r.note(
        frame('task_started', {
          task_id: 'f1',
          task_type: 'local_agent',
          description: 'inline',
          is_backgrounded: false,
        }),
      ),
    ).toEqual([]);
    expect(r.note(frame('task_progress', { task_id: 'f1', usage: { tool_uses: 1 } }))).toEqual([]);
    expect(
      r.note(frame('task_updated', { task_id: 'f1', patch: { is_backgrounded: true } })),
    ).toEqual([expect.objectContaining({ taskId: 'f1', status: 'running', type: 'agent' })]);
  });

  test('ambient and unknown task types make no row; unknown types are counted', () => {
    const r = rows();
    expect(
      r.note(frame('task_started', { task_id: 'x', task_type: 'local_agent', ambient: true })),
    ).toEqual([]);
    expect(r.note(frame('task_started', { task_id: 'y', task_type: 'remote_workflow' }))).toEqual(
      [],
    );
    expect(r.unknownTypes.get('remote_workflow')).toBe(1);
  });

  test('tasks still running at step end become orphaned; settled ones are left alone', () => {
    const r = rows();
    r.note(frame('task_started', { task_id: 'a', task_type: 'local_bash', description: 'a' }));
    r.note(frame('task_started', { task_id: 'b', task_type: 'local_bash', description: 'b' }));
    r.note(frame('task_notification', { task_id: 'b', status: 'completed' }));
    expect(r.settleRunning('orphaned').map((t) => [t.taskId, t.status])).toEqual([
      ['a', 'orphaned'],
    ]);
    expect(r.settleRunning('stopped')).toEqual([]);
    expect(r.note(frame('task_notification', { task_id: 'a', status: 'completed' }))).toEqual([]);
  });
});
