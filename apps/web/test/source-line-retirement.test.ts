import { type TodoRecord, todoRecordSchema } from '@cairn/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { SourceIssueLine } from '../src/detail/source-issue.js';
import { I18nProvider } from '../src/i18n/provider.js';

const BASE = {
  id: 'todo-source-line',
  teamId: 'team-source-line',
  projectId: 'project-source-line',
  title: '登录页圆角',
  spec: '把登录按钮圆角改成 8px。',
  phase: 'todo' as const,
  phaseAt: 1,
  seqNum: 1,
  orderIndex: 0,
  latestBuildId: null,
  lastRunAt: null,
  hasChanges: true,
  hasPlan: false,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
  createdBy: null,
  ownerId: null,
  sourceBuildId: null,
  sourceKind: null,
  sourceRef: null,
};

function render(todo: Partial<TodoRecord>): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'en',
      children: createElement(SourceIssueLine, {
        todo: todoRecordSchema.parse({ ...BASE, ...todo }),
      }),
    }),
  );
}

describe('the retired issue row leaves the detail surface', () => {
  test('a legacy self card with no issue ref and delivered changes renders no pending row, no retry button and no issue source line', () => {
    const html = render({ sourceKind: 'github-issue-self', sourceRef: null, hasChanges: true });
    expect(html).not.toContain('source-issue-pending');
    expect(html).not.toContain('source-issue-retry');
    expect(html).not.toContain('来源 issue');
    expect(html).not.toContain('GitHub issue 未建成');
  });

  test('a Coordinator task renders the orchestration source row and its link', () => {
    const html = render({
      sourceKind: 'orchestration',
      sourceRef: 'chief:0190a0a0-0000-7000-8000-000000000001',
    });
    expect(html).toContain('data-testid="source-orchestration"');
    expect(html).toContain('data-testid="source-orchestration-link"');
    expect(html).toContain('Coordinator orchestration session');
  });

  test('a github issue card with a live ref renders no echo row', () => {
    const html = render({ sourceKind: 'github-issue', sourceRef: 'github:octo/alpha#7' });
    expect(html).not.toContain('source-issue-echo');
    expect(html).not.toContain('来源 issue');
  });
});
