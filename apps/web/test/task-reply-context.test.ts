import { encodeReplyQuote, renderTaskText, type TaskRequest, todoRecordSchema } from '@cairn/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { toDisplayTodo } from '../src/api/mappers.js';
import { SpecBlock } from '../src/detail/spec-block.js';
import { I18nProvider } from '../src/i18n/provider.js';

const reply = encodeReplyQuote({ sourceMessageId: 'ack', quote: 'The issue is recorded.' }, 'Please dispatch.');
const request: TaskRequest = {
  segments: [{
    source: { kind: 'chat', threadId: 'origin', messageId: 'dispatch', span: 'whole' },
    author: 'owner', sourceRef: null, text: reply,
    context: {
      incomplete: false,
      messages: [
        { threadId: 'origin', messageId: 'original', role: 'user', text: 'The caret is misaligned.\n![caret.png](attachment:team/caret.png)' },
        { threadId: 'origin', messageId: 'ack', role: 'assistant', text: 'The issue is recorded.' },
      ],
    },
  }],
  siblings: [], difficulty: null, titleSource: 'owner', titleSourceRef: null,
};

function render(source: TaskRequest | null, spec = source === null ? reply : renderTaskText(source)) {
  return renderToStaticMarkup(createElement(MemoryRouter, { children:
    createElement(I18nProvider, { initialLocale: 'en', children:
      createElement(SpecBlock, { spec, request: source }),
    }),
  }));
}

describe('task opening history', () => {
  test('preserves source messages from the task API through the display mapper', () => {
    const wire = todoRecordSchema.parse({
      id: 'task', teamId: 'team', projectId: 'project', title: 'Caret alignment', spec: renderTaskText(request),
      request, phase: 'todo', phaseAt: 0, seqNum: 1, orderIndex: 0, tagIds: [], latestBuildId: null,
      lastRunAt: null, hasChanges: false, hasPlan: false, buildHistory: [], sourceTodo: null, v: 1,
      createdBy: null, ownerId: null, sourceBuildId: null, sourceKind: null, sourceRef: null,
    });
    expect(toDisplayTodo(wire).request).toEqual(request);
  });

  test('a task stored with the raw reply marker as its title shows the owner words instead', () => {
    const wire = todoRecordSchema.parse({
      id: 'task', teamId: 'team', projectId: 'project', title: '<!-- reply source=ack -->', spec: renderTaskText(request),
      request, phase: 'todo', phaseAt: 0, seqNum: 1, orderIndex: 0, tagIds: [], latestBuildId: null,
      lastRunAt: null, hasChanges: false, hasPlan: false, buildHistory: [], sourceTodo: null, v: 1,
      createdBy: null, ownerId: null, sourceBuildId: null, sourceKind: null, sourceRef: null,
    });
    expect(toDisplayTodo(wire).title).toBe('The caret is misaligned.');
    expect(toDisplayTodo({ ...wire, request: undefined }).title).toBe('未命名任务');
  });

  test('shows the image, acknowledgment, and owner reply as attributed source messages', () => {
    const html = render(request);
    expect(html).toContain('data-role="owner"');
    expect(html).toContain('data-role="coordinator"');
    expect(html.match(/data-slot="user-bubble"/g)).toHaveLength(2);
    expect(html).toContain('src="/api/attachments/caret"');
    expect(html).toContain('data-testid="reply-quote"');
    expect(html).toContain('href="#request-context-origin%3Aack"');
    expect(html).toContain('Please dispatch.');
    expect(html).not.toContain('reply source=');
    expect(html.indexOf('The caret is misaligned.')).toBeLessThan(html.indexOf('The issue is recorded.'));
  });

  test('legacy reply text displays a quote and body without protocol metadata', () => {
    const html = render(null);
    expect(html).toContain('data-testid="reply-quote"');
    expect(html).toContain('Please dispatch.');
    expect(html).not.toContain('reply source=');
  });

  test('incomplete source context is visible without inventing source messages', () => {
    const incomplete = structuredClone(request);
    incomplete.segments[0]!.context = { messages: [], incomplete: true };
    const html = render(incomplete);
    expect(html).toContain('The source failed validation.');
    expect(html).not.toContain('/api/attachments/caret');
    expect(html).not.toContain('href="#request-context-origin%3Aack"');
  });
});
