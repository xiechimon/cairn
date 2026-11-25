import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type DependencyList } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { useThreadChat } from '../src/board/use-thread-chat.js';
import { CopyIconButton } from '../src/components/copy-icon-button.js';
import { docBlocksToMarkdown } from '../src/detail/docpane.js';
import { EN } from '../src/i18n/en.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { translate } from '../src/i18n/translate.js';

vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return {
    ...react,
    useEffect: (_effect: () => void | (() => void), _deps?: DependencyList) => {},
    useSyncExternalStore: <T>(
      subscribe: (onChange: () => void) => () => void,
      snapshot: () => T,
      serverSnapshot = snapshot,
    ) => react.useSyncExternalStore(subscribe, snapshot, serverSnapshot),
  };
});
vi.mock('../src/api/provider.js', () => ({
  useLiveData: () => ({ live: true, teamId: 'team', userName: 'Owner' }),
}));
vi.mock('../src/board/use-mark-thread-read.js', () => ({ useMarkThreadRead: () => {} }));

describe('docBlocksToMarkdown', () => {
  test('serializes headings, paragraphs, bullets, inline code, links, and breaks to Markdown', () => {
    const markdown = docBlocksToMarkdown([
      { kind: 'head', segments: [{ text: '改动' }] },
      {
        kind: 'para',
        segments: [
          { text: 'Check ' },
          { text: 'README.md', style: 'link' },
          { text: ' with ' },
          { text: 'pnpm test', style: 'code' },
          { text: ' and ' },
          { text: 'docs', style: 'anchor', href: 'https://example.com/docs' },
          { text: '.', strong: true, em: true, del: true },
        ],
      },
      {
        kind: 'bullet',
        segments: [
          { text: 'First ' },
          { text: 'bold', style: 'strong' },
          { text: '', style: 'break' },
          { text: 'second' },
        ],
      },
      { kind: 'bullet', segments: [{ text: 'Third item' }] },
    ]);

    expect(markdown).toBe(
      [
        '## 改动',
        '',
        'Check `README.md` with `pnpm test` and [docs](https://example.com/docs)*~~.~~*',
        '',
        '- First **bold**',
        '  second',
        '- Third item',
      ].join('\n'),
    );
  });

  test('returns empty string for empty blocks', () => {
    expect(docBlocksToMarkdown([])).toBe('');
  });
});

describe('useThreadChat planMarkdown', () => {
  test('preserves raw Markdown from latestPlan in live mode', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const rawPlan = [
      '# Migration Plan',
      '',
      '## Steps',
      '- Run `pnpm test`',
      '- Read [spec](https://example.com/spec)',
      '',
      '```ts',
      'export const ok = true;',
      '```',
    ].join('\n');

    qc.setQueryData(['todo', 'todo-plan'], {
      id: 'todo-plan',
      teamId: 'team',
      projectId: 'proj',
      title: 'Plan copy test',
      spec: '',
      phase: 'confirm',
      phaseAt: 1,
      archivedAt: null,
      seqNum: 12,
      orderIndex: 0,
      assignment: null,
      agent: null,
      latestBuildId: 'build-plan',
      lastRunAt: 1,
      hasChanges: false,
      hasPlan: true,
      buildHistory: [],
      sourceTodo: null,
      v: 1,
    });
    qc.setQueryData(['plans', 'build-plan'], [
      { id: 'p1', buildId: 'build-plan', version: 1, content: rawPlan, stepId: 's1', createdAt: 1 },
    ]);

    let capturedPlanMarkdown: string | null = null;
    function Probe() {
      const chat = useThreadChat('todo-plan', undefined);
      capturedPlanMarkdown = chat.planMarkdown;
      return null;
    }

    renderToStaticMarkup(
      createElement(QueryClientProvider, {
        client: qc,
        children: createElement(MemoryRouter, {
          initialEntries: ['/app?thread=todo-plan'],
          children: createElement(I18nProvider, {
            initialLocale: 'zh',
            children: createElement(Probe),
          }),
        }),
      }),
    );

    expect(capturedPlanMarkdown).toBe(rawPlan);
  });
});

describe('Copy as Markdown copy and i18n wiring', () => {
  test('translates 复制为 Markdown and 已复制 in English locale', () => {
    expect(translate('en', EN, '复制为 Markdown')).toBe('Copy as Markdown');
    expect(translate('en', EN, '已复制')).toBe('Copied');
    expect(EN['复制为 Markdown']).toBe('Copy as Markdown');
  });

  test('CopyIconButton renders accessible label for Copy as Markdown', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(CopyIconButton, {
          text: '# Report',
          label: 'Copy as Markdown',
          copiedLabel: 'Copied',
          testId: 'copy-markdown',
        }),
      }),
    );
    expect(html).toContain('aria-label="Copy as Markdown"');
    expect(html).toContain('data-testid="copy-markdown"');
  });
});
