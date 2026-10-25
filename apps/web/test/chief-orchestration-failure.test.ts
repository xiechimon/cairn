import { type ChiefThread, orchestrateThreadTitle } from '@cairn/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { TodoCard } from '../src/board/todo-card.js';
import { cardOrchestration, inflightOrchestrationFor } from '../src/chief/orchestration-inflight.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { I18nProvider } from '../src/i18n/provider.js';

const reason = '400 context_length_exceeded: maximum context length is 200000 tokens';
const failed: ChiefThread = {
  id: 'chief-failed', title: orchestrateThreadTitle(1586), createdAt: 2,
  chiefId: 'chief-u-t', userId: 'u', teamId: 't', updatedAt: 2, lastTurnAt: 2,
  session: { runtime: 'pi', id: '', openedAt: 2 }, pendingSessionResumeAt: null,
  toolDefHashes: {}, toolResultHashes: {},
  activeRun: null, turnQueue: null, lastTurnError: reason,
};
const todo: TodoRecord = {
  id: 'todo-1586', seqNum: 1586, title: '修复编排', phase: 'todo', phaseAt: 0,
  hasPlan: false, hasChanges: false,
  teamId: 't', projectId: 'p', spec: '', orderIndex: 0, tagIds: [], assignment: null,
  agent: null, latestBuildId: null, lastRunAt: null, buildHistory: [], sourceTodo: null, v: 1,
};

function render(threads: ChiefThread[]) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, {}, createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(TodoCard, { todo, now: 0, orchestration: cardOrchestration(threads, 1586) }),
    })),
  );
}

test('a failed context-length round leaves orchestration and displays its reason with retry', () => {
  expect(inflightOrchestrationFor([failed], 1586)).toBeNull();
  const html = render([failed]);
  expect(html).toContain('编排失败');
  expect(html).toContain(reason);
  expect(html).toContain('重试');
  expect(html).not.toContain('data-orchestrating="true"');
});

test('a newer round clears the old failure and unrelated cards do not inherit it', () => {
  const retry = { ...failed, id: 'chief-retry', createdAt: 3, activeRun: { phase: 'chief' }, lastTurnError: undefined };
  expect(render([failed, retry])).toContain('data-orchestrating="true"');
  expect(render([failed, retry])).not.toContain(reason);
  expect(cardOrchestration([failed], 1587)).toBeNull();
});
