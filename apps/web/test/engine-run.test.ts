import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { engineTranscript, engineUsageSummary } from '../src/board/engine-run.js';
import { EngineRawView } from '../src/board/engine-run-view.js';
import { earlierStepCount } from '../src/detail/work-trace.js';
import {
  ENGINE_SCRIPTS,
  enginePhase,
  engineRunAt,
  engineScriptSteps,
} from '../src/fixtures/engine-runs.js';
import { I18nProvider } from '../src/i18n/provider.js';

const script = ENGINE_SCRIPTS.running;
const planOf = (shown: number, answers = {}) =>
  engineRunAt(script, shown, answers).plan.map((step) => step.state);

describe('engine run view model', () => {
  it('fills the usage rows a live thread fills, keeping what the run does not know', () => {
    const summary = {
      cost: '—',
      tokens: '1.2k',
      cached: '',
      models: [],
      machines: [],
      duration: '',
      engines: [],
    };
    const run = engineRunAt(script, 0);
    const usage = (elapsedSeconds: number | null, costUsd: number | null) =>
      engineUsageSummary(summary, { ...run, elapsedSeconds, costUsd });
    expect(usage(252, 0.21)).toMatchObject({
      engines: ['Claude Code'],
      duration: '4m 12s',
      cost: '$0.21',
      tokens: '1.2k',
    });
    expect(usage(10, 0.004).cost).toBe('$0.0040');
    expect(usage(null, null)).toMatchObject({ duration: '', cost: '—' });
  });

  it('folds earlier steps only when more than one would hide', () => {
    expect([0, 5, 6, 7, 25].map(earlierStepCount)).toEqual([0, 0, 0, 2, 20]);
  });

  it('keeps a narration preamble between tool calls in one work block', () => {
    const items = engineTranscript({
      engine: 'Claude Code',
      state: 'finished',
      elapsedSeconds: 12,
      costUsd: 0.05,
      plan: [],
      rawOutput: '',
      events: [
        { kind: 'read', id: 'r1', path: 'a.ts', lines: 10, seconds: 0.2 },
        { kind: 'text', id: 'p1', text: 'Next, update the handler.' },
        { kind: 'edit', id: 'e1', file: { path: 'a.ts', added: 1, removed: 1, hunks: [] } },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'work',
      steps: [
        { kind: 'call', action: 'read' },
        { kind: 'say', text: 'Next, update the handler.' },
        { kind: 'call', action: 'edit' },
      ],
    });
  });

  it('ignores non-finite or negative costUsd in usage summary', () => {
    const summary = {
      cost: '—',
      tokens: '—',
      cached: '',
      models: [],
      machines: [],
      duration: '',
      engines: [],
    };
    const run = engineRunAt(script, 0);
    expect(engineUsageSummary(summary, { ...run, costUsd: Number.NaN }).cost).toBe('—');
    expect(engineUsageSummary(summary, { ...run, costUsd: -1 }).cost).toBe('—');
  });

  it('renders empty raw output without an inert copy button and uses keyboard focus ring on log', () => {
    const emptyHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(EngineRawView, {
          run: { ...engineRunAt(script, 0), rawOutput: '' },
        }),
      }),
    );
    expect(emptyHtml).toContain('引擎尚无输出');
    expect(emptyHtml).not.toContain('data-testid="engine-raw-copy"');
    expect(emptyHtml).toContain('focus-visible:');
  });
});

describe('fixture engine run at a step', () => {
  it('ticks the plan as events are revealed', () => {
    expect(planOf(1)).toEqual(['doing', 'todo', 'todo', 'todo']);
    expect(planOf(3)).toEqual(['done', 'done', 'doing', 'todo']);
    expect(planOf(8)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('shows the last command as still running until the next event arrives', () => {
    expect(engineRunAt(script, 4).events.at(-1)).toMatchObject({ kind: 'run', exit: null });
    expect(engineRunAt(script, 5).events[3]).toMatchObject({ kind: 'run', exit: 0 });
  });

  it('waits on an unanswered question and treats a passed one as allowed', () => {
    const waiting = engineRunAt(script, 6);
    expect(waiting.state).toBe('waiting');
    expect(waiting.events.at(-1)).toMatchObject({ kind: 'question', answer: null });
    expect(engineRunAt(script, 7).events[5]).toMatchObject({ answer: 'allowed' });
  });

  it('reports time and cost only once the run has ended', () => {
    expect(engineRunAt(script, 7)).toMatchObject({ state: 'running', costUsd: null });
    expect(engineRunAt(script, 8)).toMatchObject({
      state: 'finished',
      elapsedSeconds: 252,
      costUsd: 0.21,
    });
    expect(engineRunAt(ENGINE_SCRIPTS.failed, 6).state).toBe('failed');
  });

  it('ends on the refused branch without the refused command', () => {
    const answers = { 'ask-upload': 'refused' } as const;
    expect(engineScriptSteps(script, answers)).toHaveLength(7);
    const run = engineRunAt(script, 7, answers);
    expect(run.state).toBe('finished');
    expect(run.events.map((event) => event.id)).not.toContain('run-upload');
    expect(planOf(7, answers)).toEqual(['done', 'done', 'todo', 'todo']);
  });

  it('never drops an unknown event', () => {
    const run = engineRunAt(script, 6);
    expect(run.events).toHaveLength(6);
    expect(run.events[4]).toMatchObject({ kind: 'unknown', type: 'context_compaction' });
    expect(run.rawOutput.split('\n').at(-1)).toContain('(y/n)');
  });

  it('maps the run state onto the thread phase the head shows', () => {
    expect((['running', 'waiting', 'finished', 'failed'] as const).map(enginePhase)).toEqual([
      'building',
      'needs_input',
      'done',
      'failed',
    ]);
  });

  it('clamps a step outside the script', () => {
    expect(engineRunAt(script, 0).events).toHaveLength(1);
    expect(engineRunAt(ENGINE_SCRIPTS.long, 999).state).toBe('finished');
  });
});
