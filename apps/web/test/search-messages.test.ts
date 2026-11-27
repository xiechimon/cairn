import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ComponentProps, createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useSearchResults } from '../src/api/hooks.js';
import { MAX_MESSAGE_JUMP_PAGES, messageHitHref, messageJumpStep } from '../src/board/message-jump.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { SearchPanel } from '../src/overlay/search-panel.js';

vi.mock('../src/api/provider.js', () => ({
  useLiveData: () => ({ live: false, teamId: 'team-1', userName: 'Owner' }),
}));

vi.mock('../src/components/ui/dialog-shell.js', () => ({
  DIALOG_FACE: 'dialog-face',
  VIEWPORT_POP_ANIM: 'pop-anim',
  DialogShell: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open ? createElement('div', { 'data-mock-dialog': '' }, children) : null,
}));

vi.mock('../src/desktop-shell.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/desktop-shell.js')>()),
  useDesktopMenu: () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSearchPanel(props: Partial<ComponentProps<typeof SearchPanel>>): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client: qc,
      children: createElement(MemoryRouter, {
        children: createElement(I18nProvider, {
          initialLocale: 'zh',
          children: createElement(SearchPanel, {
            fixture: { todos: [], now: 0 },
            open: true,
            query: '',
            onClose: () => {},
            onQuery: () => {},
            ...props,
          }),
        }),
      }),
    }),
  );
}

describe('SearchPanel chat message hits', () => {
  test('renders matching message rows with channel badge when serverQueryText matches query', () => {
    const html = renderSearchPanel({
      query: '再加',
      serverQueryText: '再加',
      server: {
        todos: [],
        projects: [],
        messages: [
          {
            id: 'm1',
            threadId: 'ct-x',
            projectId: 'p-x',
            projectName: 'X',
            role: 'user',
            snippet: '第二条：再加2呢',
            createdAt: 1_750_000_000_000,
          },
          {
            id: 'm2',
            threadId: 'ct-coord',
            projectId: null,
            projectName: null,
            role: 'assistant',
            snippet: 'Coordinator 里也提到再加一次',
            createdAt: 1_750_000_000_100,
          },
        ],
      },
    });
    expect(html).toContain('data-row-kind="message"');
    expect(html).toContain('第二条：再加2呢');
    expect(html).toContain('X');
    expect(html).toContain('Coordinator');
    expect(html).not.toContain('没有与“再加”匹配的结果');
  });

  test('hides stale server messages when serverQueryText lags behind query or when search failed', () => {
    const staleHtml = renderSearchPanel({
      query: '1+1',
      serverQueryText: '再加',
      server: {
        todos: [],
        projects: [],
        messages: [
          {
            id: 'm1',
            threadId: 'ct-x',
            projectId: 'p-x',
            projectName: 'X',
            role: 'user',
            snippet: '第二条：再加2呢',
            createdAt: 1_750_000_000_000,
          },
        ],
      },
    });
    expect(staleHtml).not.toContain('data-row-kind="message"');
    expect(staleHtml).not.toContain('第二条：再加2呢');

    const errorHtml = renderSearchPanel({
      query: '再加',
      serverQueryText: '再加',
      serverQuery: { isError: true, isFetching: false, refetch: () => {} },
      server: {
        todos: [],
        projects: [],
        messages: [
          {
            id: 'm1',
            threadId: 'ct-x',
            projectId: 'p-x',
            projectName: 'X',
            role: 'user',
            snippet: '第二条：再加2呢',
            createdAt: 1_750_000_000_000,
          },
        ],
      },
    });
    expect(errorHtml).toContain('data-testid="search-error"');
    expect(errorHtml).not.toContain('data-row-kind="message"');
  });
});

describe('useSearchResults teamId isolation', () => {
  test('useSearchResults accepts teamId and exposes settledQuery without throwing', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let captured: ReturnType<typeof useSearchResults> | undefined;
    function Probe() {
      captured = useSearchResults('再加', false, 'team-a');
      return null;
    }
    renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc, children: createElement(Probe) }),
    );
    expect(captured).toBeDefined();
    expect(captured).toHaveProperty('settledQuery');
  });
});

describe('messageHitHref & messageJumpStep', () => {
  test('builds Coordinator and project hrefs while preserving scenario and clearing obstructing params', () => {
    expect(
      messageHitHref(
        { id: 'm1', threadId: 'ct-x', projectId: 'p-x' },
        '?scenario=01&thread=t1&pane=tasks&artifact=a1',
      ),
    ).toBe('/app?scenario=01&project=p-x&chat=1&msg=m1');

    expect(
      messageHitHref({ id: 'm2', threadId: 'ct-coord', projectId: null }, '?thread=t1&pane=made'),
    ).toBe('/app?chief=ct-coord&msg=m2');
  });

  test('resolves jump steps: idle, focus, load-earlier, wait, and missing on cap/failure/end', () => {
    expect(
      messageJumpStep(null, {
        loaded: true,
        stream: [],
        hasEarlier: false,
        loadingEarlier: false,
        failedEarlier: false,
        pagesLoaded: 0,
      }),
    ).toEqual({ kind: 'idle' });

    expect(
      messageJumpStep('m1', {
        loaded: false,
        stream: [{ kind: 'user', id: 'm1', text: 'hi' }],
        hasEarlier: true,
        loadingEarlier: false,
        failedEarlier: false,
        pagesLoaded: 0,
      }),
    ).toEqual({ kind: 'wait' });

    expect(
      messageJumpStep('m1', {
        loaded: true,
        stream: [{ kind: 'robot', id: 'm1', markdown: 'ok', seconds: '' }],
        hasEarlier: true,
        loadingEarlier: false,
        failedEarlier: false,
        pagesLoaded: 0,
      }),
    ).toEqual({ kind: 'focus', messageId: 'm1' });

    expect(
      messageJumpStep('m1', {
        loaded: true,
        stream: [],
        hasEarlier: true,
        loadingEarlier: false,
        failedEarlier: false,
        pagesLoaded: 0,
      }),
    ).toEqual({ kind: 'load-earlier' });

    expect(
      messageJumpStep('m1', {
        loaded: true,
        stream: [],
        hasEarlier: true,
        loadingEarlier: true,
        failedEarlier: false,
        pagesLoaded: 1,
      }),
    ).toEqual({ kind: 'wait' });

    expect(
      messageJumpStep('m1', {
        loaded: true,
        stream: [],
        hasEarlier: true,
        loadingEarlier: false,
        failedEarlier: true,
        pagesLoaded: 1,
      }),
    ).toEqual({ kind: 'missing' });

    expect(
      messageJumpStep('m1', {
        loaded: true,
        stream: [],
        hasEarlier: false,
        loadingEarlier: false,
        failedEarlier: false,
        pagesLoaded: 0,
      }),
    ).toEqual({ kind: 'missing' });

    expect(
      messageJumpStep('m1', {
        loaded: true,
        stream: [],
        hasEarlier: true,
        loadingEarlier: false,
        failedEarlier: false,
        pagesLoaded: MAX_MESSAGE_JUMP_PAGES,
      }),
    ).toEqual({ kind: 'missing' });
  });
});
