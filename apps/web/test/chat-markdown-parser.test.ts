import { describe, expect, it } from 'vitest';
import {
  type ChatBlock,
  chatBubbleGroups,
  inlineSegments,
  parseChatMarkdown,
} from '../src/lib/markdown.js';

function kinds(text: string): ChatBlock['kind'][] {
  return parseChatMarkdown(text).map((block) => block.kind);
}

describe('markdown blocks through the maintained parser', () => {
  it('parses a blockquote with its inner paragraph', () => {
    const [quote] = parseChatMarkdown('> 这是一段引用');
    expect(quote?.kind).toBe('quote');
    if (quote?.kind !== 'quote') return;
    expect(quote.blocks).toEqual([{ kind: 'para', segments: [{ text: '这是一段引用' }] }]);
  });

  it('keeps every heading level', () => {
    const levels = parseChatMarkdown('# 一\n\n## 二\n\n### 三\n\n#### 四').map((block) =>
      block.kind === 'head' ? block.level : 0,
    );
    expect(levels).toEqual([1, 2, 3, 4]);
  });

  it('renders - [ ] and - [x] as a read-only task list', () => {
    const [list] = parseChatMarkdown('- [ ] 未完成\n- [x] 已完成');
    expect(list?.kind).toBe('list');
    if (list?.kind !== 'list') return;
    expect(list.items.map((item) => item.checked)).toEqual([false, true]);
    expect(list.items[0]?.blocks).toEqual([{ kind: 'para', segments: [{ text: '未完成' }] }]);
  });

  it("keeps the agent todo card for the agent's [~] and [/] progress markers", () => {
    const [tasks] = parseChatMarkdown('- [x] 查文档\n- [~] 写代码\n- [/] 跑测试\n- [ ] 开 PR');
    expect(tasks?.kind).toBe('tasks');
    if (tasks?.kind !== 'tasks') return;
    expect(tasks.items.map((item) => item.state)).toEqual(['done', 'doing', 'doing', 'todo']);
    expect(tasks.items.map((item) => item.segments.map((s) => s.text).join(''))).toEqual([
      '查文档',
      '写代码',
      '跑测试',
      '开 PR',
    ]);
  });

  it('splits a loose list into plain items and the agent card, stripping the markers', () => {
    const blocks = parseChatMarkdown('- 顶层要点\n  - 嵌套要点\n\n- [x] 查文档\n- [~] 写代码\n- [ ] 跑测试');
    expect(blocks.map((block) => block.kind)).toEqual(['list', 'tasks']);
    const tasks = blocks[1];
    if (tasks?.kind !== 'tasks') return;
    expect(tasks.items.map((item) => [item.state, item.segments.map((s) => s.text).join('')])).toEqual([
      ['done', '查文档'],
      ['doing', '写代码'],
      ['todo', '跑测试'],
    ]);
  });

  it('does not render raw HTML: tags stay literal text', () => {
    const blocks = parseChatMarkdown('<script>alert(1)</script>\n\n文字 <b>粗</b>');
    expect(blocks.map((block) => block.kind)).toEqual(['para', 'para']);
    const text = blocks
      .flatMap((block) => (block.kind === 'para' ? block.segments.map((s) => s.text) : []))
      .join('|');
    expect(text).toContain('<script>');
    expect(text).toContain('<b>');
    expect(blocks.flatMap((b) => (b.kind === 'para' ? b.segments : [])).every((s) => s.href === undefined)).toBe(true);
  });

  it('drops unsafe link schemes to literal text and keeps http(s) links', () => {
    const segs = inlineSegments('[a](javascript:alert(1)) [b](data:text/html,x) [c](https://example.com)');
    expect(segs.filter((s) => s.style === 'anchor')).toEqual([
      { text: 'c', style: 'anchor', href: 'https://example.com' },
    ]);
    expect(segs.map((s) => s.text).join('')).toContain('[a](javascript:alert(1))');
  });

  it('autolinks a bare URL', () => {
    expect(inlineSegments('见 https://example.com/a 页')).toContainEqual({
      text: 'https://example.com/a',
      style: 'anchor',
      href: 'https://example.com/a',
    });
  });

  it('marks italic and strikethrough runs', () => {
    expect(inlineSegments('*斜体* 和 ~~删除线~~')).toEqual([
      { text: '斜体', em: true },
      { text: ' 和 ' },
      { text: '删除线', del: true },
    ]);
  });

  it('closes emphasis next to CJK punctuation', () => {
    expect(inlineSegments('**「引用」**后面')).toEqual([
      { text: '「引用」', style: 'strong' },
      { text: '后面' },
    ]);
  });

  it('turns a single newline into a line break', () => {
    expect(inlineSegments('早上好\n你当前任务的进展')).toEqual([
      { text: '早上好' },
      { text: '\n', style: 'break' },
      { text: '你当前任务的进展' },
    ]);
  });
});

describe('streaming partial markdown', () => {
  it('an unclosed fence is a code block that grows in place', () => {
    const first = parseChatMarkdown('说明：\n\n```python\nfrom pathlib');
    const later = parseChatMarkdown('说明：\n\n```python\nfrom pathlib import Path\n');
    expect(first.map((b) => b.kind)).toEqual(['para', 'code']);
    expect(later.map((b) => b.kind)).toEqual(['para', 'code']);
    expect(later[1]?.kind === 'code' && later[1].text).toBe('from pathlib import Path');
  });

  it('a table header without its separator stays a paragraph, then becomes a table', () => {
    expect(kinds('| 名称 | 数量 |')).toEqual(['para']);
    expect(kinds('| 名称 | 数量 |\n| --- | ---: |')).toEqual(['table']);
    const [table] = parseChatMarkdown('| 名称 | 数量 |\n| --- | ---: |\n| 苹果 | 3');
    expect(table?.kind === 'table' && table.rows.length).toBe(1);
    expect(table?.kind === 'table' && table.align).toEqual([null, 'right']);
  });
});

describe('reply bubbles', () => {
  it('gives each block separated by a blank line its own bubble', () => {
    const groups = chatBubbleGroups('第一段\n\n# 一级标题\n\n## 二级标题\n\n> 引用');
    expect(groups.map((g) => g.blocks.map((b) => b.kind))).toEqual([
      ['para'],
      ['head'],
      ['head'],
      ['quote'],
    ]);
    expect(groups.every((g) => g.bubble)).toBe(true);
  });

  it('keeps a paragraph and the list right under it in one bubble', () => {
    const groups = chatBubbleGroups('你当前任务的进展：\n1. 第一项\n2. 第二项');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.blocks.map((b) => b.kind)).toEqual(['para', 'list']);
    expect(groups[0]?.source).toBe('你当前任务的进展：\n1. 第一项\n2. 第二项');
  });

  it('merges consecutive lists even across a blank line', () => {
    const groups = chatBubbleGroups('- 无序一\n- 无序二\n\n1. 有序一\n2. 有序二');
    expect(groups.map((g) => g.blocks.map((b) => b.kind))).toEqual([['list', 'list']]);
  });

  it('gives each run of a mixed list its own source, once', () => {
    const plainThenCheck = chatBubbleGroups('- Notes\n- [ ] Deploy');
    expect(plainThenCheck.map((group) => group.source).join('\n')).toBe('- Notes\n- [ ] Deploy');
    const plainThenProgress = chatBubbleGroups('- Notes\n- More\n- [/] Deploy\n- Done');
    expect(plainThenProgress.map((group) => group.source).join('\n')).toBe(
      '- Notes\n- More\n- [/] Deploy\n- Done',
    );
    for (const group of plainThenProgress) {
      expect(group.source.match(/Notes/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it('leaves tables, code and attachments outside the bubbles', () => {
    const groups = chatBubbleGroups(
      '前言\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```sh\nls\n```\n\n![图](attachment:team-1/shot.png)\n\n结尾',
    );
    expect(groups.map((g) => [g.blocks[0]?.kind, g.bubble])).toEqual([
      ['para', true],
      ['table', false],
      ['code', false],
      ['attachment', false],
      ['para', true],
    ]);
  });
});

describe('progress checklist items keep everything under them', () => {
  const tasksOf = (text: string) => {
    const tasks = parseChatMarkdown(text).find((block) => block.kind === 'tasks');
    if (tasks?.kind !== 'tasks') throw new Error('no tasks block');
    return tasks.items;
  };
  const textOf = (blocks: ChatBlock[]): string => JSON.stringify(blocks);

  it('keeps nested bullets under a progress item', () => {
    const [deploy] = tasksOf('- [~] Deploy\n  - Run migrations\n  - Restart services');
    expect(deploy?.segments.map((s) => s.text).join('')).toBe('Deploy');
    expect(deploy?.blocks.map((block) => block.kind)).toEqual(['list']);
    expect(textOf(deploy?.blocks ?? [])).toContain('Run migrations');
    expect(textOf(deploy?.blocks ?? [])).toContain('Restart services');
  });

  it('keeps a second paragraph under a progress item', () => {
    const [deploy] = tasksOf('- [~] Deploy\n\n  Waiting on the staging window.');
    expect(textOf(deploy?.blocks ?? [])).toContain('Waiting on the staging window.');
  });

  it('keeps a fenced code block under a progress item', () => {
    const [deploy] = tasksOf('- [/] Deploy\n\n  ```sh\n  pnpm migrate\n  ```');
    expect(deploy?.blocks).toEqual([{ kind: 'code', lang: 'sh', text: 'pnpm migrate' }]);
  });

  it('keeps the children of a sibling item in the same run', () => {
    const items = tasksOf('- [x] Build\n  - Lint passed\n- [~] Deploy');
    expect(items.map((item) => item.state)).toEqual(['done', 'doing']);
    expect(textOf(items[0]?.blocks ?? [])).toContain('Lint passed');
    expect(items[1]?.blocks).toEqual([]);
  });
});
