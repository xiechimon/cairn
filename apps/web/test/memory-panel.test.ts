// @vitest-environment happy-dom
import type { MemoryRecord } from '@cairn/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { MemoryPanel } from '../src/chief/memory-panel.js';
import { DialogShell } from '../src/components/ui/dialog-shell.js';
import { I18nProvider } from '../src/i18n/provider.js';

vi.mock('../src/chief/memory-edit-composer.js', () => ({
  MemoryEditComposer: () => null,
  memoryEditTouchedFiles: () => new Set(),
}));

vi.mock('../src/board/project-instructions-field.js', () => ({
  ProjectInstructionsField: () => null,
}));

const memories: MemoryRecord[] = ['Verification', 'Code style', 'Review'].map((title, index) => ({
  id: `memory-${index}`,
  agentId: 't1',
  teamId: 't1',
  title,
  content: `${title} summary\n- ${title} detail`,
  projectId: null,
  sourceTodoId: null,
  sourceBuildId: null,
  layer: index === 1 ? 'searchable' : 'core',
  createdAt: 1,
  updatedAt: 1,
}));

const clients: QueryClient[] = [];
const roots: ReturnType<typeof createRoot>[] = [];

beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const client of clients.splice(0)) client.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(['memories', 't1'], memories);
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path.endsWith('/memories')) return memories;
    if (path.endsWith('/candidates')) return { candidates: [] };
    if (path.endsWith('/memory-usage')) return { usage: null };
    return null;
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const close = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return createElement(DialogShell, {
      open,
      title: 'Memories',
      onClose: () => {
        close();
        setOpen(false);
      },
      children: createElement(MemoryPanel, { live: true, teamId: 't1', project: null }),
    });
  }
  const render = () =>
    act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(I18nProvider, { initialLocale: 'en', children: createElement(Harness) }),
        ),
      );
    });
  return { client, root, close, render };
}

function button(text: string) {
  const element = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === text,
  );
  if (element === undefined) throw new Error(`Button not found: ${text}`);
  return element;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function openConfirmation() {
  const row = document.querySelector<HTMLElement>('[aria-label="Open memory: Code style"]');
  if (row === null) throw new Error('Memory row is missing');
  await click(row);
  const trigger = button('Delete…');
  await click(trigger);
  return { row, trigger };
}

function rows() {
  return Array.from(document.querySelectorAll('[data-slot="memory-row"]')).map((row) => ({
    label: row.getAttribute('aria-label'),
    text: row.textContent,
  }));
}

test('the detail dialog is not rendered behind the confirmation', async () => {
  const { render } = setup();
  await render();
  await openConfirmation();
  await vi.waitFor(() => {
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"][aria-label="Code style"]')).toBeNull();
  });
});

test('cancelling the confirmation exits the flow and focuses the memory row', async () => {
  const { close, render } = setup();
  await render();
  const before = rows();
  expect(before).toHaveLength(3);
  const { row } = await openConfirmation();
  await click(button('Cancel'));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(row);
  });
  expect(document.querySelector('[role="dialog"][aria-label="Code style"]')).toBeNull();
  expect(document.querySelector('[role="dialog"][aria-label="Memories"]')).not.toBeNull();
  expect(close).not.toHaveBeenCalled();
  expect(rows()).toEqual(before);
});

test.each(['before', 'after'] as const)(
  'a failed DELETE resolving %s dialog unmount preserves the entire cached and rendered list',
  async (timing) => {
    const { client, root, render } = setup();
    let rejectDelete: (reason: Error) => void = () => {
      throw new Error('DELETE response is not initialized');
    };
    const response = new Promise<void>((_resolve, reject) => {
      rejectDelete = reject;
    });
    const deletion = vi.spyOn(api, 'del').mockImplementation(() => response);
    await render();
    const before = rows();
    expect(before).toHaveLength(3);
    const cached = structuredClone(client.getQueryData(['memories', 't1']));
    expect(cached).toEqual(memories);
    const { row } = await openConfirmation();
    await click(button('Delete memory'));
    expect(deletion).toHaveBeenCalledExactlyOnceWith('/api/teams/t1/memories/memory-1');
    expect(client.getQueryData(['memories', 't1'])).toEqual(cached);
    if (timing === 'after') await act(async () => root.render(null));
    await act(async () => rejectDelete(new Error('Delete failed')));
    expect(
      client.getMutationCache().getAll().some((mutation) => mutation.state.status === 'error'),
    ).toBe(true);
    expect(client.getQueryData(['memories', 't1'])).toEqual(cached);
    if (timing === 'before') {
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(
          'The memory was not deleted and is unchanged. Try again.',
        );
      });
      await click(button('Cancel'));
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(document.activeElement).toBe(row);
      });
      expect(rows()).toEqual(before);
      await act(async () => root.render(null));
    }
    await render();
    expect(rows()).toEqual(before);
    expect(client.getQueryData(['memories', 't1'])).toEqual(cached);
  },
);
