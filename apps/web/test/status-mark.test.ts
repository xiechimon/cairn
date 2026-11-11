import { describe, expect, it } from 'vitest';
import {
  FULL_PEN,
  finishedTurn,
  isActiveMark,
  lastTurnOf,
  MARK_DRAW_MS,
  MARK_ERASE_MS,
  markPath,
  STATUS_MARK_IDS,
  type StatusMarkInput,
  statusMarkView,
  toolMarkState,
  transitionFrame,
} from '../src/chief/status-mark.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

const USER: ChiefStreamItem = { kind: 'user', text: '帮我看看 r3-lifecycle 的构建' };
const REPLY: ChiefStreamItem = { kind: 'robot', markdown: '构建已经修好了。', seconds: '12s' };

function input(over: Partial<StatusMarkInput['chief']> = {}, rest: Partial<StatusMarkInput> = {}) {
  return {
    chief: { running: true, stream: [USER], ...over },
    questionPending: false,
    connected: true,
    ...rest,
  } satisfies StatusMarkInput;
}

describe('statusMarkView', () => {
  it('is idle when no turn runs and the last turn replied', () => {
    expect(statusMarkView(input({ running: false, stream: [USER, REPLY] }))).toEqual({
      id: 'idle',
      label: '',
      announce: true,
    });
  });

  it('shows the error cross when the last turn failed', () => {
    const view = statusMarkView(
      input({ running: false, stream: [USER, { kind: 'error', text: 'model refused' }] }),
    );
    expect(view.id).toBe('error');
    expect(view.label).toBe('出错了');
  });

  it('a pending question is ask, even while a tool runs', () => {
    expect(statusMarkView(input({ runningTool: 'bash' }, { questionPending: true })).id).toBe('ask');
  });

  it('a lost connection is offline with the banner wording and no second announcement', () => {
    expect(statusMarkView(input({}, { connected: false }))).toEqual({
      id: 'offline',
      label: '连接断开，正在重连…',
      announce: false,
    });
  });

  it('an outage waits to resume', () => {
    const view = statusMarkView(
      input({ outage: { reason: 'quota', model: 'claude-sonnet-5', retryAt: null } }),
    );
    expect(view).toEqual({ id: 'offline', label: '等待恢复', announce: false });
  });

  it('a queue waiting for an offline machine is offline', () => {
    const view = statusMarkView(
      input({
        stream: [
          USER,
          { kind: 'streaming', label: '排队中：等 {machine} 上线（前面 {ahead} 个）' },
        ],
      }),
    );
    expect(view.id).toBe('offline');
    expect(view.label).toBe('等待电脑上线');
  });

  it('uses the running tool from the activity before the trace', () => {
    expect(statusMarkView(input({ runningTool: 'create_todo' })).id).toBe('task');
  });

  it('falls back to the running tool row of the live turn', () => {
    const view = statusMarkView(
      input({
        stream: [
          USER,
          {
            kind: 'streaming',
            label: '处理中...',
            tools: [{ label: 'projects' }, { label: 'bash pnpm test', running: true }],
          },
        ],
      }),
    );
    expect(view.id).toBe('run');
  });

  it('is replying while reply text streams in', () => {
    const typing: ChiefStreamItem = { kind: 'robot', markdown: '我先看', typing: true, seconds: '' };
    expect(statusMarkView(input({ stream: [USER, typing] })).id).toBe('write');
    expect(
      statusMarkView(input({ stream: [USER, { kind: 'streaming', label: '模型输出中...' }] })).id,
    ).toBe('write');
  });

  it('thinks while running with nothing more specific', () => {
    expect(statusMarkView(input({ stream: [USER, { kind: 'streaming', label: '处理中...' }] })).id).toBe(
      'think',
    );
    expect(statusMarkView(input({ stream: [USER, { kind: 'thinking', text: '先读' }] })).id).toBe(
      'think',
    );
  });
});

describe('toolMarkState', () => {
  it.each(['bash', 'Bash', 'shell_exec', 'run_command'])('runs a command through %s', (tool) => {
    expect(toolMarkState(tool)).toBe('run');
  });

  it.each(['create_todo', 'open_thread', 'message_thread', 'schedule_create', 'TodoWrite'])(
    'creates a task through %s',
    (tool) => {
      expect(toolMarkState(tool)).toBe('task');
    },
  );

  it.each(['projects', 'todos', 'threads', 'read_history', 'search_history', 'Read', 'Grep'])(
    'looks through %s',
    (tool) => {
      expect(toolMarkState(tool)).toBe('look');
    },
  );

  it.each(['save_memory', 'notify_user', 'browser_act', 'mystery'])('thinks through %s', (tool) => {
    expect(toolMarkState(tool)).toBe('think');
  });
});

describe('done after a finished turn', () => {
  it('reads the last turn from the stream', () => {
    expect(lastTurnOf([USER, REPLY])).toBe('reply');
    expect(lastTurnOf([USER])).toBe(null);
    expect(lastTurnOf([USER, { kind: 'error', text: 'x' }])).toBe('error');
    expect(lastTurnOf([USER, { ...REPLY, typing: true }])).toBe(null);
  });

  it('shows done only when an active turn ends in a reply', () => {
    expect(finishedTurn(true, 'idle', 'reply')).toBe(true);
    expect(finishedTurn(false, 'idle', 'reply')).toBe(false);
    expect(finishedTurn(true, 'idle', null)).toBe(false);
    expect(finishedTurn(true, 'error', 'error')).toBe(false);
  });

  it('counts working states as active and waiting states as not', () => {
    expect(['think', 'write', 'look', 'run', 'task'].every((id) => isActiveMark(id as never))).toBe(
      true,
    );
    expect(['idle', 'ask', 'done', 'error', 'offline'].some((id) => isActiveMark(id as never))).toBe(
      false,
    );
  });
});

describe('transitionFrame', () => {
  it('erases the old line along its path first', () => {
    const frame = transitionFrame('idle', 'run', MARK_ERASE_MS / 2, false);
    expect(frame.shown).toBe('idle');
    expect(frame.pen[0]).toBeGreaterThan(0);
    expect(frame.pen[1]).toBe(1);
  });

  it('then draws the new line from its start', () => {
    const frame = transitionFrame('idle', 'run', MARK_ERASE_MS + MARK_DRAW_MS / 2, false);
    expect(frame.shown).toBe('run');
    expect(frame.pen[0]).toBe(0);
    expect(frame.pen[1]).toBeLessThan(1);
  });

  it('rests on the full line after both phases', () => {
    expect(transitionFrame('idle', 'run', MARK_ERASE_MS + MARK_DRAW_MS, false)).toEqual({
      shown: 'run',
      pen: FULL_PEN,
    });
  });

  it('swaps at once under reduced motion', () => {
    expect(transitionFrame('idle', 'run', 0, true)).toEqual({ shown: 'run', pen: FULL_PEN });
  });
});

describe('markPath', () => {
  it.each(STATUS_MARK_IDS)('draws %s inside the viewbox', (id) => {
    const d = markPath(id, 1500, FULL_PEN, false);
    const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(d.startsWith('M')).toBe(true);
    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers.every((n) => Math.abs(n) < 44)).toBe(true);
  });

  it('gives every state its own still form', () => {
    const forms = new Set(STATUS_MARK_IDS.map((id) => markPath(id, 0, FULL_PEN, true)));
    expect(forms.size).toBe(STATUS_MARK_IDS.length);
  });

  it('holds still under reduced motion', () => {
    expect(markPath('run', 0, FULL_PEN, true)).toBe(markPath('run', 900, FULL_PEN, true));
  });

  it('keeps moving while a command runs', () => {
    expect(markPath('run', 0, FULL_PEN, false)).not.toBe(markPath('run', 400, FULL_PEN, false));
  });

  it('draws nothing with an empty pen', () => {
    expect(markPath('idle', 0, [0.5, 0.5], true)).toBe('');
  });
});
