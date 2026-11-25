import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { BuildRecord, StepJournalRow, TodoRetryState } from '@cairn/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { mapTranscript } from '../src/api/mappers.js';
import { ChiefStreamRow } from '../src/chief/chief-message-rows.js';
import { MessageScroller, MessageScrollerProvider } from '../src/components/ui/message-scroller.js';
import { Transcript } from '../src/detail/transcript.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { NOW, todo } from './helpers.js';

const SRC = resolve(import.meta.dirname, '../src');
const SHARED = 'components/chat/failure-marker.tsx';
const ROW_DIRS = ['detail', 'components/chat'];
const ROW_FILE = /^chief\/[\w-]*rows?\.tsx$/;
const FAIL_TONE = /--fail-fg|--destructive|text-destructive|chat-para--fail/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) ? [relative(SRC, path)] : [];
  });
}

function offenders(): string[] {
  return sources(SRC).filter((file) => {
    if (file === SHARED) return false;
    const code = readFileSync(join(SRC, file), 'utf8');
    if (!/<CircleAlert\b/.test(code)) return false;
    const marker = /components\/ui\/marker\.js|['"]\.\/marker\.js['"]/.test(code);
    const row = ROW_DIRS.some((dir) => file.startsWith(`${dir}/`)) || ROW_FILE.test(file);
    return marker || (row && FAIL_TONE.test(code));
  });
}

test('C32: a failure row in a conversation is drawn only by FailureMarker', () => {
  expect(
    offenders(),
    `C32: these files draw their own failure row; render FailureMarker from src/${SHARED} instead`,
  ).toEqual([]);
});

const BUILD: BuildRecord = {
  id: 'build-status-row',
  todoId: 'todo-1',
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: 'fetch failed: ECONNRESET',
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: NOW - 60_000,
};

function retried(retry: TodoRetryState): TodoRecord {
  return { ...todo(1, 'failed'), retry };
}

function quotaStep(): StepJournalRow {
  return {
    id: 'step-quota',
    buildId: BUILD.id,
    kind: 'build',
    machineId: null,
    createdAt: NOW - 30_000,
    status: 'waiting_quota',
    checkpointCommit: null,
    skillInjection: null,
    quotaWait: {
      kind: 'quota',
      providerId: 'claude',
      label: 'Claude Pro',
      retryAfterMs: null,
      probeAt: NOW + 5 * 60_000,
    },
  };
}

function transcriptHtml(record: TodoRecord, steps: StepJournalRow[] = []): string {
  const items = mapTranscript({
    messages: [{ id: 'm1', role: 'user', content: '修一下网络超时', createdAt: NOW - 50_000 }],
    steps,
    build: { ...BUILD, errorMessage: record.phase === 'failed' ? BUILD.errorMessage : null },
    todo: record,
    machineName: null,
    userName: 'ian',
    liveText: '',
  });
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(MessageScrollerProvider, {
        children: createElement(MessageScroller, {
          children: createElement(Transcript, { transcript: items }),
        }),
      }),
    }),
  );
}

function markerLabels(html: string): string[] {
  return [...html.matchAll(/data-testid="failure-marker-label"[^>]*>([^<]*)</g)].map(
    (match) => match[1] ?? '',
  );
}

const STATUS_ROWS: { name: string; html: () => string; reason: string }[] = [
  {
    name: 'waiting to retry',
    reason: '网络中断',
    html: () =>
      transcriptHtml(
        retried({
          state: 'scheduled',
          failureClass: 'transient',
          reasonCode: 'network',
          attempt: 2,
          maxAttempts: 20,
          nextRetryAt: NOW + 3 * 60_000,
          windowEndsAt: NOW + 6 * 3_600_000,
        }),
      ),
  },
  {
    name: 'parked',
    reason: '环境初始化失败，已停止自动重试',
    html: () =>
      transcriptHtml(
        retried({
          state: 'parked',
          failureClass: 'permanent',
          reasonCode: 'setup_hook',
          attemptsMade: 0,
          detail: null,
        }),
      ),
  },
  {
    name: 'quota wait',
    reason: 'Claude Pro：额度',
    html: () => transcriptHtml(todo(1, 'building'), [quotaStep()]),
  },
];

test.each(STATUS_ROWS)(
  'C32: the $name row is one FailureMarker separator line with no typing dots',
  ({ html, reason }) => {
    const markup = html();
    const labels = markerLabels(markup);
    expect(labels, `C32: the transcript must show one FailureMarker line for "${reason}"`).toHaveLength(1);
    expect(labels[0]).toContain(reason);
    expect(markup.split(reason).length - 1, `C32: "${reason}" is drawn outside FailureMarker`).toBe(1);
    expect(markup, 'C32: a waiting row carries no typing dots').not.toContain('typing-dot');
    expect(markup, 'C32: no own alert block beside the marker').not.toContain('role="alert"');
  },
);

test('Stopped. No task was created. and stopped-with-task render with the same separator marker as Not finished', () => {
  const renderRow = (item: Parameters<typeof ChiefStreamRow>[0]['item']) =>
    renderToStaticMarkup(
      createElement(MemoryRouter, {
        children: createElement(I18nProvider, {
          initialLocale: 'en',
          children: createElement(MessageScrollerProvider, {
            children: createElement(MessageScroller, {
              children: createElement(ChiefStreamRow, {
                item,
                index: 0,
                onCopy: () => {},
                onRewindRequest: () => {},
              }),
            }),
          }),
        }),
      }),
    );

  const errorHtml = renderRow({ kind: 'error', text: 'Request failed', id: 'e1' });
  const stoppedEmptyHtml = renderRow({ kind: 'stopped', todos: [], id: 's1' });
  const stoppedTaskHtml = renderRow({
    kind: 'stopped',
    todos: [{ id: 'todo-1', seq: 1, title: 'Audit notices' }],
    id: 's2',
  });

  expect(errorHtml).toContain('data-slot="marker"');
  expect(errorHtml).toContain('data-variant="separator"');

  for (const html of [stoppedEmptyHtml, stoppedTaskHtml]) {
    expect(html).toContain('data-testid="chief-stopped"');
    expect(html).toContain('data-slot="marker"');
    expect(html).toContain('data-variant="separator"');
    expect(html).toContain('data-testid="failure-marker-label"');
    expect(html).not.toContain('font-reply');
  }
  expect(stoppedEmptyHtml).toContain('Stopped. No task was created.');
  expect(stoppedTaskHtml).toContain('Stopped. A task was already created before the stop:');
});
