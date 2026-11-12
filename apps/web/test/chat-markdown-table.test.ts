import { describe, expect, it } from 'vitest';
import { parseChatMarkdown } from '../src/lib/markdown.js';

function cellTexts(row: { text: string }[][]): string[] {
  return row.map((cell) => cell.map((s) => s.text).join(''));
}

describe('parseChatMarkdown GFM tables', () => {
  it('renders a multi-line pipe table as a table block', () => {
    const blocks = parseChatMarkdown(
      ['| 名称 | 状态 | CLI 版本 |', '| --- | --- | --- |', '| omarchy | 在线 | 0.2.3 |'].join(
        '\n',
      ),
    );
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') return;
    expect(cellTexts(table.header)).toEqual(['名称', '状态', 'CLI 版本']);
    expect(table.align).toEqual([null, null, null]);
    expect(table.rows).toHaveLength(1);
    expect(cellTexts(table.rows[0] ?? [])).toEqual(['omarchy', '在线', '0.2.3']);
  });

  it('expands collapsed || row joins into the same table', () => {
    const blocks = parseChatMarkdown(
      '| 名称 | 状态 | CLI 版本 || --- | --- | --- || omarchy | 在线 | 0.2.3 |',
    );
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') return;
    expect(cellTexts(table.header)).toEqual(['名称', '状态', 'CLI 版本']);
    expect(cellTexts(table.rows[0] ?? [])).toEqual(['omarchy', '在线', '0.2.3']);
  });

  it('keeps alignment markers from the separator row', () => {
    const blocks = parseChatMarkdown(
      ['| left | center | right |', '| :--- | :---: | ---: |', '| a | b | c |'].join('\n'),
    );
    const table = blocks[0];
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') return;
    expect(table.align).toEqual(['left', 'center', 'right']);
  });

  it('preserves empty cells in multi-line tables', () => {
    const blocks = parseChatMarkdown(['| a | | c |', '| --- | --- | --- |', '| 1 | 2 |  |'].join('\n'));
    const table = blocks[0];
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') return;
    expect(cellTexts(table.header)).toEqual(['a', '', 'c']);
    expect(cellTexts(table.rows[0] ?? [])).toEqual(['1', '2', '']);
  });

  it('parses inline markup inside cells', () => {
    const blocks = parseChatMarkdown(['| **Name** | `id` |', '| --- | --- |', '| x | y |'].join('\n'));
    const table = blocks[0];
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') return;
    expect(table.header[0]).toEqual([{ text: 'Name', style: 'strong' }]);
    expect(table.header[1]).toEqual([{ text: 'id', style: 'code' }]);
  });

  it('leaves a header without a separator as a paragraph', () => {
    const blocks = parseChatMarkdown('| a | b |\n| c | d |');
    expect(blocks.every((b) => b.kind !== 'table')).toBe(true);
    expect(blocks.some((b) => b.kind === 'para')).toBe(true);
  });

  it('does not treat || inside a lone row as a table without a separator', () => {
    const blocks = parseChatMarkdown('| a || b |');
    expect(blocks.every((b) => b.kind !== 'table')).toBe(true);
  });

  it('keeps fence contents literal, including pipe tables', () => {
    const src = ['```', '| a | b |', '| --- | --- |', '| 1 | 2 |', '```'].join('\n');
    const blocks = parseChatMarkdown(src);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('code');
    if (blocks[0]?.kind !== 'code') return;
    expect(blocks[0].text).toContain('| a | b |');
  });

  it('stops the table body at a blank line', () => {
    const blocks = parseChatMarkdown(
      ['| a | b |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n'),
    );
    expect(blocks.map((b) => b.kind)).toEqual(['table', 'para']);
    if (blocks[1]?.kind !== 'para') return;
    expect(blocks[1].segments.map((s) => s.text).join('')).toBe('after');
  });

  it('rejects collapsed || when column counts disagree after expansion', () => {
    const blocks = parseChatMarkdown('| a || b || --- | --- | --- || 1 | 2 |');
    expect(blocks.every((b) => b.kind !== 'table')).toBe(true);
  });
});
