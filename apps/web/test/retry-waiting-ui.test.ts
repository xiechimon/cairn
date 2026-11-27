import { automaticRetryRowContent, type BuildRecord, type RetryReasonCode } from '@cairn/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { mapTranscript } from '../src/api/mappers.js';
import {
  formatRetryClock,
  parkedRetryCopy,
  scheduledFailureHeadline,
  scheduledRetryPhrase,
  todoRetryPhrase,
} from '../src/board/retry-copy.js';
import { glyphOf, taskRowCopy, unfinishableLead } from '../src/board/tasks-sections.js';
import { StatusGlyph } from '../src/components/status-glyph.js';
import { MessageScroller, MessageScrollerProvider } from '../src/components/ui/message-scroller.js';
import { Transcript } from '../src/detail/transcript.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { EN } from '../src/i18n/en.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { NOW, todo } from './helpers.js';

const RETRY_AT = NOW + 3 * 60_000;
const RETRY_CLOCK = formatRetryClock(RETRY_AT);

const WAITING_TODO: TodoRecord = {
  ...todo(1, 'failed'),
  section: 'working',
  retry: {
    state: 'scheduled',
    failureClass: 'transient',
    reasonCode: 'network',
    attempt: 2,
    maxAttempts: 20,
    nextRetryAt: RETRY_AT,
    windowEndsAt: NOW + 6 * 3_600_000,
  },
};

const PARKED_TODO: TodoRecord = {
  ...todo(2, 'failed'),
  section: 'needs_input',
  retry: {
    state: 'parked',
    failureClass: 'permanent',
    reasonCode: 'setup_hook',
    attemptsMade: 0,
    detail: null,
  },
};

const FAILED_BUILD: BuildRecord = {
  id: 'build-retry-ui',
  todoId: WAITING_TODO.id,
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

function renderTranscriptHtml(record: TodoRecord, locale: 'zh' | 'en' = 'zh'): string {
  const items = mapTranscript({
    messages: [{ id: 'm1', role: 'user', content: '修一下网络超时', createdAt: NOW - 50_000 }],
    steps: [],
    build: { ...FAILED_BUILD, todoId: record.id },
    todo: record,
    machineName: null,
    userName: 'ian',
    liveText: '',
  });
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(MessageScrollerProvider, {
        children: createElement(MessageScroller, {
          children: createElement(Transcript, { transcript: items }),
        }),
      }),
    }),
  );
}

describe('waiting-to-retry exact clock time and waiting visual treatment', () => {
  test('uses exact clock time across retry phrase, header subtitle, task list row, transcript, and English table', () => {
    const retry = WAITING_TODO.retry;
    if (retry?.state !== 'scheduled') throw new Error('expected scheduled retry');

    const expected = {
      key: '{time} 自动重试（第 {attempt} 次）',
      params: { time: RETRY_CLOCK, attempt: 2 },
    };

    expect(scheduledRetryPhrase(retry)).toEqual(expected);
    expect(todoRetryPhrase(WAITING_TODO)).toEqual(expected);
    expect(taskRowCopy({ todo: WAITING_TODO, section: 'working' }).what).toEqual(expected);

    const zhHtml = renderTranscriptHtml(WAITING_TODO, 'zh');
    expect(zhHtml).toContain(`${RETRY_CLOCK} 自动重试（第 2 次）`);
    expect(zhHtml).not.toContain('分钟后');

    const enHtml = renderTranscriptHtml(WAITING_TODO, 'en');
    expect(EN['{time} 自动重试（第 {attempt} 次）']).toContain('{time}');
    expect(enHtml).toContain(RETRY_CLOCK);
    expect(enHtml).not.toContain('in 3 minutes');
  });

  test('waiting-to-retry renders the waiting FailureMarker while parked keeps the failure marker', () => {
    expect(glyphOf({ todo: WAITING_TODO, section: 'working' })).toBe('queued');
    const waitingLead = unfinishableLead(WAITING_TODO);
    expect(waitingLead.glyph).toBe('queued');
    expect(renderToStaticMarkup(createElement(StatusGlyph, { kind: waitingLead.glyph, outlined: true }))).toContain(
      'data-glyph="queued"',
    );

    const parkedLead = unfinishableLead(PARKED_TODO);
    expect(parkedLead.glyph).toBe('failed');
    expect(renderToStaticMarkup(createElement(StatusGlyph, { kind: parkedLead.glyph, outlined: true }))).toContain(
      'data-glyph="failed"',
    );

    const waitingHtml = renderTranscriptHtml(WAITING_TODO, 'zh');
    expect(waitingHtml).toContain('data-waiting=""');
    expect(waitingHtml).toContain('role="status"');
    expect(waitingHtml).toContain(`网络中断 · ${RETRY_CLOCK} 自动重试（第 2 次）`);

    const parkedHtml = renderTranscriptHtml(PARKED_TODO, 'zh');
    expect(parkedHtml).toContain('role="note"');
    expect(parkedHtml).not.toContain('data-waiting');
    expect(parkedHtml).toContain('环境初始化失败，已停止自动重试');
  });

  test('new retry reason codes render unified waiting headlines and missing_tool detail in zh and en', () => {
    const newCodes: [RetryReasonCode, string, string][] = [
      ['runtime_exited', '运行环境意外退出', 'Agent runtime exited unexpectedly'],
      ['runtime_startup_timeout', '运行环境启动超时', 'Agent runtime startup timed out'],
      ['stream_timeout', '模型响应超时', 'The model did not respond in time'],
      ['silent_no_op', '本轮未返回结果', 'No output returned from this round'],
    ];
    for (const [code, zhText, enText] of newCodes) {
      const headline = scheduledFailureHeadline(code);
      expect(headline.key).toBe(zhText);
      expect(EN[headline.key]).toBe(enText);
      const record: TodoRecord = {
        ...WAITING_TODO,
        retry: {
          state: 'scheduled',
          failureClass: 'transient',
          reasonCode: code,
          attempt: 1,
          maxAttempts: null,
          nextRetryAt: RETRY_AT,
          windowEndsAt: NOW + 6 * 3_600_000,
        },
      };
      expect(renderTranscriptHtml(record, 'zh')).toContain(zhText);
      expect(renderTranscriptHtml(record, 'en')).toContain(enText);
    }

    const missingTool = parkedRetryCopy({
      state: 'parked',
      failureClass: 'permanent',
      reasonCode: 'missing_tool',
      attemptsMade: 0,
      detail: 'antigravity',
    });
    expect(missingTool.title).toEqual({
      key: '缺少所需工具（{tool}），已停止自动重试',
      params: { tool: 'antigravity' },
    });
    expect(EN[missingTool.title.key]).toContain('{tool}');

    const disk = parkedRetryCopy({
      state: 'parked',
      failureClass: 'permanent',
      reasonCode: 'disk',
      attemptsMade: 0,
      detail: null,
    });
    expect(disk.title).toEqual({ key: '执行机磁盘已满' });
    expect(disk.fix).toEqual({
      key: 'Cairn 无法写入本轮记录。请在这台执行机上腾出磁盘空间后重试。',
    });
    expect(EN[disk.title.key]).toBe('The Runner disk is full');
    expect(EN[disk.fix.key]).toContain('Free disk space');
  });

  test('structured and legacy automatic-retry system rows render through NoticeLine with optional detail', () => {
    const structured = automaticRetryRowContent({
      attempt: 2,
      maxAttempts: 3,
      reasonCode: 'stream_timeout',
      failureClass: 'transient',
      detail: { runtime: 'antigravity', timeoutMs: 30_000 },
      priorError: 'model response stream timed out after 30s',
    });
    const items = mapTranscript({
      messages: [
        { id: 'm1', role: 'user', content: '修一下', createdAt: NOW - 50_000 },
        { id: 's1', role: 'system', content: structured, createdAt: NOW - 30_000 },
        {
          id: 's2',
          role: 'system',
          content: 'Automatic retry after rate limit',
          createdAt: NOW - 10_000,
        },
      ],
      steps: [],
      build: { ...FAILED_BUILD, errorMessage: null },
      todo: { ...todo(3, 'building') },
      machineName: null,
      userName: 'ian',
      liveText: '',
    });
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(MessageScrollerProvider, {
          children: createElement(MessageScroller, {
            children: createElement(Transcript, { transcript: items }),
          }),
        }),
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'automatic-retry',
        attempt: 2,
        maxAttempts: 3,
        priorError: 'model response stream timed out after 30s',
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'automatic-retry',
        attempt: 0,
        maxAttempts: null,
        priorError: null,
      }),
    );
    expect(html).toContain('data-testid="transcript-automatic-retry"');
    expect(html).toContain('模型响应超时 · 自动重试（第 2/3 次）');
    expect(html.match(/data-testid="failure-marker-detail"/g)).toHaveLength(1);
    expect(html).toContain('已触发限流 · 自动重试');
  });
});
