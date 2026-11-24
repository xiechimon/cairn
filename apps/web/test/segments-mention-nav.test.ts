import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { ChatMarkdown } from '../src/detail/chat-markdown.js';
import { Segments, type TodoGlance, TodoGlanceContext } from '../src/detail/segments.js';
import type { DocSegment } from '../src/fixtures/records.js';
import { I18nProvider } from '../src/i18n/provider.js';

function page(children: ReactNode, glances: ReadonlyMap<string, TodoGlance> | null = null): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, {
      children: createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(TodoGlanceContext.Provider, { value: glances, children }),
      }),
    }),
  );
}

function render(segments: DocSegment[]): string {
  return page(createElement(Segments, { segments, codeClassName: 'chat-code' }));
}

function plain(markup: string): string {
  return markup.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function mention(
  kind: NonNullable<DocSegment['mentionKind']>,
  id: string | undefined,
  text = 'scribe',
): DocSegment {
  return id === undefined
    ? { text, style: 'mention', mentionKind: kind }
    : { text, style: 'mention', mentionKind: kind, mentionId: id };
}

describe('segments mention navigation seam (#741)', () => {
  test('F-U1: an agent mention is its name as plain text: no chip, no anchor, with or without an id', () => {
    for (const id of ['a1', undefined]) {
      const markup = render([mention('agent', id)]);
      expect(markup).toBe('<span data-slot="agent-mention">scribe</span>');
    }
  });

  test('F-U3: a todo mention opens its thread in the side chat on the home', () => {
    const markup = render([{ text: '#1', style: 'mention', mentionKind: 'todo', mentionId: 't1' }]);
    expect(markup).toMatch(/<a [^>]*href="\/app\?thread=t1"/);
  });

  test('F-U4: skill/project/machine segments with id stay spans (negative — landing unproven, not in this ticket)', () => {
    for (const kind of ['skill', 'project', 'machine'] as const) {
      const markup = render([mention(kind, 'x1')]);
      expect(markup, kind).not.toContain('<a ');
      expect(markup, kind).toContain(`mention-chip--${kind}`);
    }
  });

  test('F-U5: chip class family keeps accent (mention-chip mention-chip--skill)', () => {
    const markup = render([mention('skill', 's1')]);

    expect(markup).toMatch(/class="[^"]*\bmention-chip\b[^"]*"/);
    expect(markup).toMatch(/class="[^"]*\bmention-chip--skill\b[^"]*"/);
    expect(markup).toContain('text-content-secondary');
  });
});

describe('a Markdown task link names the task by its title (C15)', () => {
  const KNOWN = new Map<string, TodoGlance>([
    ['t7', { phase: 'building', seq: 7, title: 'Export the report as CSV' }],
  ]);

  test('a known task shows its title and state, never its number', () => {
    const markup = page(
      createElement(ChatMarkdown, { text: 'Started [#7](todo:t7) just now.' }),
      KNOWN,
    );
    expect(plain(markup)).toContain('Started Export the report as CSV just now.');
    expect(plain(markup)).not.toContain('#7');
    expect(markup).toMatch(/<a [^>]*data-phase="building"/);
  });

  test('a task the page does not know reads as a task, with no number', () => {
    for (const glances of [KNOWN, null]) {
      const markup = page(
        createElement(ChatMarkdown, { text: 'See [#9](todo:gone) first.' }),
        glances,
      );
      expect(plain(markup)).toContain('See 任务 first.');
      expect(plain(markup)).not.toContain('#9');
    }
  });

  test('the mention is an unframed word: its state glyph and title, named with its state', () => {
    const markup = page(
      createElement(ChatMarkdown, { text: 'Started [#7](todo:t7) just now.' }),
      KNOWN,
    );
    expect(markup).not.toContain('mention-chip');
    expect(markup).toMatch(/<a [^>]*aria-label="Export the report as CSV，执行中"/);
    expect(markup).toMatch(/<svg [^>]*data-glyph="working"/);
  });

  test('a link label that is not a bare number keeps the words its author chose', () => {
    const markup = page(
      createElement(ChatMarkdown, { text: 'See [the export task](todo:t7).' }),
      KNOWN,
    );
    expect(plain(markup)).toContain('See the export task.');
  });

  const ESSAY = new Map<string, TodoGlance>([
    ['e6', { phase: 'closed', seq: 6, title: '写一篇 100 字的作文' }],
    ['t7', { phase: 'building', seq: 7, title: 'Export the report as CSV' }],
  ]);

  test('a number the model wrote in prose followed by that task title becomes the title chip', () => {
    const markup = page(
      createElement(ChatMarkdown, {
        text: '已停掉写作文的那个任务（#6 写一篇 100 字的作文），任务还开着。',
        bubbles: true,
      }),
      ESSAY,
    );
    expect(plain(markup)).toBe('已停掉写作文的那个任务写一篇 100 字的作文，任务还开着。');
    expect(markup).toMatch(/<a [^>]*data-phase="closed"[^>]*href="\/app\?thread=e6"/);
  });

  test('a quoted title after the number and 任务 #n both become chips', () => {
    const markup = page(
      createElement(ChatMarkdown, { text: '#7「Export the report as CSV」排在任务 #6 后面' }),
      ESSAY,
    );
    expect(plain(markup)).toBe('Export the report as CSV排在任务 写一篇 100 字的作文 后面');
    expect(markup.match(/data-slot="task-mention"/g)).toHaveLength(2);
  });

  test('numbers that are not task references stay literal', () => {
    for (const text of [
      'PR #6 写一篇 100 字的作文',
      'xiechimon/cairn#6 写一篇 100 字的作文',
      '#6 是另一件事',
      '`#6 写一篇 100 字的作文`',
      '任务 #9 不存在',
    ]) {
      const markup = page(createElement(ChatMarkdown, { text }), ESSAY);
      expect(markup, text).not.toContain('task-mention');
    }
  });
});
