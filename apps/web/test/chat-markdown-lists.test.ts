import { describe, expect, it } from 'vitest';
import { nestLists, parseChatMarkdown } from '../src/detail/chat-markdown.js';

type ListBlock = Parameters<typeof nestLists>[0][number];

function listBlocks(text: string): ListBlock[] {
  return parseChatMarkdown(text).filter(
    (block): block is ListBlock => block.kind === 'bullet' || block.kind === 'ordered',
  );
}

function shape(text: string) {
  const walk = (lists: ReturnType<typeof nestLists>): unknown[] =>
    lists.map((list) => ({
      ordered: list.ordered,
      items: list.entries.map((entry) => ({
        text: entry.block.segments.map((seg) => seg.text).join(''),
        children: walk(entry.children),
      })),
    }));
  return walk(nestLists(listBlocks(text)));
}

describe('nestLists', () => {
  it('nests an indented bullet under the ordered item above it and keeps numbering in one list', () => {
    expect(shape('1. one\n   - child\n2. two')).toEqual([
      {
        ordered: true,
        items: [
          { text: 'one', children: [{ ordered: false, items: [{ text: 'child', children: [] }] }] },
          { text: 'two', children: [] },
        ],
      },
    ]);
  });

  it('starts a new list when the kind changes at the same depth', () => {
    expect(shape('- a\n- b\n1. c')).toEqual([
      { ordered: false, items: [{ text: 'a', children: [] }, { text: 'b', children: [] }] },
      { ordered: true, items: [{ text: 'c', children: [] }] },
    ]);
  });

  it('keeps a leading indented item as its own list instead of dropping it', () => {
    expect(shape('  - deep\n- top')).toEqual([
      { ordered: false, items: [{ text: 'deep', children: [] }] },
      { ordered: false, items: [{ text: 'top', children: [] }] },
    ]);
  });

  it('closes several levels at once when the indent drops back to the top', () => {
    expect(shape('- a\n  - b\n    - c\n- d')).toEqual([
      {
        ordered: false,
        items: [
          {
            text: 'a',
            children: [
              {
                ordered: false,
                items: [
                  {
                    text: 'b',
                    children: [{ ordered: false, items: [{ text: 'c', children: [] }] }],
                  },
                ],
              },
            ],
          },
          { text: 'd', children: [] },
        ],
      },
    ]);
  });
});
