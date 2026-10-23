// #728 插入面单测——insertMentionText 的尾随空格 + caret 落点 + 区间替换。
// 正典双参考：CC rule 26（accept → token + trailing space）+ todos.dev
// r9 §3.2（插入形 ` @r3-builder ` 两侧带空格）。每条用例钉票面失败方式：
//   I1 尾随空格缺失或 caret 落 token 内（失败方式 6：继续键入插进
//      `[label](scheme:id)` 中段 → markdown 破坏）
//   I2 插入位置错位（失败方式 5：`at = caret - query.length - 1` 的
//      重算漂移会吃掉邻近文本——改用存储区间 [start, replaceEnd) 替换）
//   I3 共享 helper 回归（失败方式 11：前导空格逻辑与 append 路径是
//      popover 多选 / 新建任务对话框两消费面的既有行为，不得漂移）
//   I4 @query 残留（现状缺陷：inline 路径只插不删，`hello @bu` 插完
//      变 `hello [builder](agent:a1)@bu`——replaceEnd 修复后钉死）
import { describe, expect, test } from 'vitest';
import {
  type FileMentionEntry,
  buildInlineRows,
  formatFileInsert,
  insertFileText,
  insertMentionText,
  type InlineRosterGroups,
  type MentionToken,
  parseDraftChips,
  parseMentionSegments,
  serializeMention,
} from '../src/overlay/mention-token.js';

const BUILDER: MentionToken = { kind: 'agent', label: 'builder', id: 'a1' };
const SERIALIZED = serializeMention(BUILDER); // [builder](agent:a1)

describe('insertMentionText 尾随空格 + caret（I1/rule 26 + r9 §3.2）', () => {
  test('文末插入：token + 一个尾随空格，caret 落空格后', () => {
    const r = insertMentionText('hello ', BUILDER, 6);
    expect(r.value).toBe(`hello ${SERIALIZED} `);
    expect(r.caret).toBe(r.value.length);
  });

  test('词中插入：前后各补一个空格（r9 §3.2 两侧带空格形）', () => {
    // caret 紧贴非空白（"hello|world"）——前导空格补、尾随空格补
    const r = insertMentionText('helloworld', BUILDER, 5);
    expect(r.value).toBe(`hello ${SERIALIZED} world`);
    expect(r.caret).toBe(6 + SERIALIZED.length + 1); // 尾随空格之后
  });

  test('后邻已是空白：不双空格，caret 仍落 token 后（尾随空白即 caret 位）', () => {
    const r = insertMentionText('hello  world', BUILDER, 6);
    expect(r.value).toBe(`hello ${SERIALIZED} world`);
    expect(r.caret).toBe(6 + SERIALIZED.length);
  });

  test('前邻已是空白：不双前导空格（既有行为不回归，I3）', () => {
    const r = insertMentionText('hi ', BUILDER, 3);
    expect(r.value).toBe(`hi ${SERIALIZED} `);
    expect(r.value.startsWith('hi  ')).toBe(false);
  });

  test('at = null 追加路径：piece 两侧带空格（I3 既有行为）', () => {
    const r = insertMentionText('draft', BUILDER, null);
    expect(r.value).toBe(`draft ${SERIALIZED} `);
    expect(r.caret).toBe(r.value.length);
  });

  test('caret 落点可继续键入：插入后紧接字符落尾随空格之后，不破坏 markdown（I1）', () => {
    const r = insertMentionText('', BUILDER, 0);
    const typed = `${r.value.slice(0, r.caret)}x${r.value.slice(r.caret)}`;
    expect(typed).toBe(`${SERIALIZED} x`);
    // round-trip：插入产物仍解析回同一个 mention chip
    const segs = parseMentionSegments(r.value);
    expect(segs.filter((s) => s.kind === 'mention')).toHaveLength(1);
  });
});

describe('insertMentionText 区间替换（I2+I4，inline @ 路径）', () => {
  test('@query 被整个替换，无残留（I4 现状缺陷钉死）', () => {
    // "hello @bu" 检测区间 [6, 9)——替换后只剩序列化 token + 尾随空格
    const r = insertMentionText('hello @bu', BUILDER, 6, 9);
    expect(r.value).toBe(`hello ${SERIALIZED} `);
    expect(r.caret).toBe(r.value.length);
  });

  test('@query 后还有文本：替换区间只吃 [start, end)，邻近文本原样（I2）', () => {
    const r = insertMentionText('@bu rest', BUILDER, 0, 3);
    expect(r.value).toBe(`${SERIALIZED} rest`);
    expect(r.caret).toBe(SERIALIZED.length); // 后邻是空格 → 不补尾随
  });

  test('空 query（裸 @）替换：只吃 @ 一个字符', () => {
    const r = insertMentionText('hi @', BUILDER, 3, 4);
    expect(r.value).toBe(`hi ${SERIALIZED} `);
  });

  test('replaceEnd 缺省 = 纯插入（popover / 新建任务路径不受影响，I3）', () => {
    const r = insertMentionText('hello @bu', BUILDER, 6);
    // 无 replaceEnd 时不删任何字符——@bu 保留（popover 语义）
    expect(r.value).toContain('@bu');
  });

  test('replaceEnd 越界钳制到 value 长度（防陈旧区间吃穿文本，I2）', () => {
    const r = insertMentionText('hello @bu', BUILDER, 6, 99);
    expect(r.value).toBe(`hello ${SERIALIZED} `);
  });
});

describe('serializeMention（既有 wire 形不回归，I3）', () => {
  test('agent → markdown link + agent: scheme', () => {
    expect(SERIALIZED).toBe('[builder](agent:a1)');
  });

  test('todo → 纯文本 #seq', () => {
    expect(serializeMention({ kind: 'todo', label: '#3', id: 't1', seq: 3 })).toBe('#3');
  });

  test('label 含 ] 与 \\ 时转义（escapeLabel 既有面）', () => {
    expect(serializeMention({ kind: 'agent', label: 'a]b\\c', id: 'x' })).toBe(
      '[a\\]b\\\\c](agent:x)',
    );
  });
});

// #760 文件插入面：裸路径文本（不走 scheme wire）+ CC 插入纪律。
// 失败方式钉死：
//   J1 含空格路径不断成两截（CC rule 27 引号包裹，否则 agent 按空白切分读错）；
//   J2 尾随空格缺失（rule 26：继续键入粘到路径上）；
//   J3 @query 残留（inline 路径消费 STORED 区间，insertMentionText I4 同律）；
//   J4 路径里的括号/方括号被误解析成 mention chip（SCHEME_REGEX 只认
//      `[label](kind:id)` 全形——`foo(bar).ts` 这类路径必须零 chip）。
describe('insertFileText 裸路径插入（#760，CC rules 26-29 同构）', () => {
  test('普通路径：尾随空格 + caret 落空格后（J2/rule 26）', () => {
    const r = insertFileText('hello @but', 'apps/web/src/ui/button.tsx', 6, 10);
    expect(r.value).toBe('hello apps/web/src/ui/button.tsx ');
    expect(r.caret).toBe(r.value.length);
  });

  test('含空格路径引号包裹（J1/rule 27）', () => {
    expect(formatFileInsert('apps/web/src/with space.ts')).toBe('"apps/web/src/with space.ts"');
    const r = insertFileText('@with', 'apps/web/src/with space.ts', 0, 5);
    expect(r.value).toBe('"apps/web/src/with space.ts" ');
  });

  test('无空白路径不加引号', () => {
    expect(formatFileInsert('apps/web/src/ui/button.tsx')).toBe('apps/web/src/ui/button.tsx');
  });

  test('目录 label 自带尾随 /（CC rule 28/29，调用方拼 label 时已加）', () => {
    const r = insertFileText('@apps', 'apps/', 0, 5);
    expect(r.value).toBe('apps/ ');
  });

  test('@query 被整个替换，无残留（J3，I4 同律）', () => {
    const r = insertFileText('hello @bu rest', 'apps/web/src/ui/button.tsx', 6, 9);
    expect(r.value).toBe('hello apps/web/src/ui/button.tsx rest');
  });

  test('插入的路径不产生 mention chip（J4：括号路径不是 scheme 形）', () => {
    const r = insertFileText('', 'apps/web/src/foo(bar).ts', 0);
    const segs = parseMentionSegments(r.value);
    expect(segs.filter((s) => s.kind === 'mention')).toHaveLength(0);
  });
});

// #812 composer chip strip 的数据源：draft 文本 → 有序 chip 行（scheme 五类
// 走 parseMentionSegments，文件走名单精确匹配）。失败方式编号（票面"先列
// 失败方式"）:
//   C1 散文幻觉 chip：名单外的路径 / 词中子串必须零 chip
//   C2 引号/目录形漏认：含空格引号包裹形、目录尾随 / 形必须命中
//   C3 重叠双 chip：同一 span 被长短两名单项同时命中时只留最长
//   C4 附件 token 误入：`![x](attachment:…)` 不是五 scheme，不得成 chip
//   C5 顺序错乱：chip 行按 draft 出现序，strip 渲染与键序才能稳定
const CHIP_FILES: FileMentionEntry[] = [
  { path: 'apps/web/src/ui/button.tsx', type: 'blob' },
  { path: 'apps/web/src/ui', type: 'tree' },
  { path: 'docs/my notes.md', type: 'blob' },
];

describe('parseDraftChips（#812，C1–C5）', () => {
  test('agent scheme 链成 chip（与 transcript 同形：label + id）', () => {
    const chips = parseDraftChips('hi [builder](agent:a1) ', CHIP_FILES);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: 'agent', id: 'a1', label: 'builder' });
  });

  test('todo scheme 链成 chip，裸 `#N` 散文不成 chip', () => {
    expect(parseDraftChips('fix #12 today', CHIP_FILES)).toHaveLength(0);
    const chips = parseDraftChips('see [#3](todo:t9) ', CHIP_FILES);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: 'todo', id: 't9', label: '#3' });
  });

  test('文件裸路径（空白边界）成 chip（C1 正例）', () => {
    const chips = parseDraftChips('see apps/web/src/ui/button.tsx ', CHIP_FILES);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      kind: 'file',
      id: 'apps/web/src/ui/button.tsx',
      label: 'apps/web/src/ui/button.tsx',
    });
  });

  test('词中子串不成 chip（C1：前邻非空白）', () => {
    expect(parseDraftChips('xapps/web/src/ui/button.tsx ', CHIP_FILES)).toHaveLength(0);
  });

  test('名单外路径不成 chip（C1）', () => {
    expect(parseDraftChips('see nope/missing.ts ', CHIP_FILES)).toHaveLength(0);
  });

  test('含空格路径引号包裹形成 chip，label 去引号（C2）', () => {
    const chips = parseDraftChips('open "docs/my notes.md" now', CHIP_FILES);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: 'file', id: 'docs/my notes.md', label: 'docs/my notes.md' });
  });

  test('目录 label 尾随 / 成 chip（C2）', () => {
    const chips = parseDraftChips('in apps/web/src/ui/ here', CHIP_FILES);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: 'file', id: 'apps/web/src/ui', label: 'apps/web/src/ui/' });
  });

  test('重叠命中只留最长（C3：短项被斜杠/引号挡在边界外）', () => {
    const overlapping: FileMentionEntry[] = [
      { path: 'docs/my', type: 'blob' },
      { path: 'docs/my notes.md', type: 'blob' },
    ];
    const chips = parseDraftChips('open "docs/my notes.md" now', overlapping);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ id: 'docs/my notes.md' });
  });

  test('附件 token 不成 chip（C4）', () => {
    expect(parseDraftChips('![pic](attachment:abc123) ', CHIP_FILES)).toHaveLength(0);
  });

  test('chip 行按 draft 出现序（C5），同路径出现两次成两 chip', () => {
    const chips = parseDraftChips(
      'apps/web/src/ui/button.tsx vs [builder](agent:a1) and apps/web/src/ui/button.tsx ',
      CHIP_FILES,
    );
    expect(chips).toHaveLength(3);
    expect(chips[0]).toMatchObject({ kind: 'file', id: 'apps/web/src/ui/button.tsx' });
    expect(chips[1]).toMatchObject({ kind: 'agent', id: 'a1' });
    expect(chips[2]).toMatchObject({ kind: 'file', id: 'apps/web/src/ui/button.tsx' });
  });

  test('空 draft / 无名单 → 空行（strip 不挂载的依据）', () => {
    expect(parseDraftChips('', CHIP_FILES)).toHaveLength(0);
    expect(parseDraftChips('hi [builder](agent:a1) ')).toHaveLength(1);
    expect(parseDraftChips('see apps/web/src/ui/button.tsx ')).toHaveLength(0);
  });
});

// #848 内联 @ 开五类：拼装序 + 跨类过滤 + cap（#728 手感复用——同一
// fuzzyFilter，不另造 matcher）。失败方式编号：
//   R1 空 query 不止 agents：五类 + 文件按拼装序（agent → todo → skill →
//      project → machine → file），仍 cap 15；
//   R2 query 只命中对应类（如 skill 名），agent 行不混入；
//   R3 smart case 跨类生效（含大写 query 大小写敏感）；
//   R4 todo 行携带 seq（插入侧 serialize 成 `#seq` 的依据）；
//   R5 files 缺省 = 纯五类面（chief / 新建任务面语义不回归）。
const ROSTER: InlineRosterGroups = {
  agent: [{ id: 'a1', label: 'builder' }],
  todo: [{ id: 't1', label: '#3 fix login', seq: 3 }],
  skill: [{ id: 's1', label: 'review' }],
  project: [{ id: 'p1', label: 'cairn' }],
  machine: [{ id: 'm1', label: 'mea' }],
};

describe('buildInlineRows（#848，R1–R5）', () => {
  test('空 query：五类 + 文件按拼装序（R1）', () => {
    const rows = buildInlineRows('', ROSTER, [{ path: 'a.ts', type: 'blob' }]);
    expect(rows.map((r) => r.kind)).toEqual(['agent', 'todo', 'skill', 'project', 'machine', 'file']);
    expect(rows[0]).toMatchObject({ kind: 'agent', id: 'a1', label: 'builder' });
    expect(rows[5]).toMatchObject({ kind: 'file', id: 'a.ts', label: 'a.ts' });
  });

  test('query 跨类过滤：只留命中的类（R2）', () => {
    const rows = buildInlineRows('rev', ROSTER, [{ path: 'a.ts', type: 'blob' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'skill', id: 's1' });
  });

  test('smart case 跨类生效（R3）', () => {
    expect(buildInlineRows('REVIEW', ROSTER)).toHaveLength(0);
    expect(buildInlineRows('review', ROSTER)).toHaveLength(1);
  });

  test('todo 行携带 seq（R4）', () => {
    const rows = buildInlineRows('', ROSTER);
    expect(rows[1]).toMatchObject({ kind: 'todo', id: 't1', seq: 3 });
  });

  test('files 缺省 = 纯五类面（R5）', () => {
    const rows = buildInlineRows('', ROSTER);
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.kind === 'file')).toBe(false);
  });

  test('空 query 仍 cap 15（R1：#728 手感不回归）', () => {
    const big: InlineRosterGroups = {
      agent: Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, label: `agent-${i}` })),
      todo: [],
      skill: [],
      project: [],
      machine: [],
    };
    expect(buildInlineRows('', big)).toHaveLength(15);
  });
});
