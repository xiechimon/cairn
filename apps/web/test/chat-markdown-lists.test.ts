import { describe, expect, it } from 'vitest';
import { type ChatBlock, parseChatMarkdown } from '../src/lib/markdown.js';

type Shape = { ordered: boolean; items: { text: string; children: Shape[] }[] };

function shapeOf(blocks: ChatBlock[]): Shape[] {
  return blocks.flatMap((block) =>
    block.kind === 'list'
      ? [
          {
            ordered: block.ordered,
            items: block.items.map((item) => ({
              text: item.blocks
                .flatMap((b) => (b.kind === 'para' ? b.segments.map((s) => s.text) : []))
                .join(''),
              children: shapeOf(item.blocks),
            })),
          },
        ]
      : [],
  );
}

const shape = (text: string) => shapeOf(parseChatMarkdown(text));

describe('markdown lists (CommonMark nesting from the parser)', () => {
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

  it('keeps a leading indented item in the list that follows it (up to three spaces is the same level)', () => {
    expect(shape('  - deep\n- top')).toEqual([
      { ordered: false, items: [{ text: 'deep', children: [] }, { text: 'top', children: [] }] },
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

  it('keeps the start number of an ordered list', () => {
    const [list] = parseChatMarkdown('3. three\n4. four');
    expect(list?.kind === 'list' && list.start).toBe(3);
  });
});
