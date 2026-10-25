import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { Segments } from '../src/detail/segments.js';
import type { DocSegment } from '../src/fixtures/records.js';

function render(segments: DocSegment[]): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(Segments, { segments, codeClassName: 'chat-code' }),
    ),
  );
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
  test('F-U1: agent segment with mentionId → anchor, href = /app/resources/agents/<id>', () => {
    const markup = render([mention('agent', 'a1')]);
    expect(markup).toMatch(/<a [^>]*href="\/app\/resources\/agents\/a1"/);
    expect(markup).toContain('scribe</a>');
  });

  test('F-U2: agent segment without mentionId → lazy span, no anchor', () => {
    const markup = render([mention('agent', undefined)]);
    expect(markup).not.toContain('<a ');
    expect(markup).toMatch(/<span [^>]*class="[^"]*mention-chip--agent/);
  });

  test('F-U3: todo segment navigation unregressed (#675 existing behavior)', () => {
    const markup = render([{ text: '#1', style: 'mention', mentionKind: 'todo', mentionId: 't1' }]);
    expect(markup).toMatch(/<a [^>]*href="\/app\/todo\/t1"/);
  });

  test('F-U4: skill/project/machine segments with id stay spans (negative — landing unproven, not in this ticket)', () => {
    for (const kind of ['skill', 'project', 'machine'] as const) {
      const markup = render([mention(kind, 'x1')]);
      expect(markup, kind).not.toContain('<a ');
      expect(markup, kind).toContain(`mention-chip--${kind}`);
    }
  });

  test('F-U5: after linking, chip class family keeps accent (mention-chip mention-chip--agent)', () => {
    const markup = render([mention('agent', 'a1')]);

    expect(markup).toMatch(/class="[^"]*\bmention-chip\b[^"]*"/);
    expect(markup).toMatch(/class="[^"]*\bmention-chip--agent\b[^"]*"/);
    expect(markup).toContain('text-(--chip-done-fg)');
    expect(markup).toContain('cursor-pointer');
  });
});
