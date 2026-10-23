// #403 看板标签筛选——纯函数面（解析/命中判定/选项集），DOM 无关故 vitest
// 直测。每条用例钉一个失败方式：
//   parseTagParam：词表外名混入不得成活选（F5）、重复名去重（F6）、
//     空值/缺参 = 空集（F7）、返回序 = 字典序规范序而非参数序（F8）、
//     词表未就绪（vocab = null）= 空集（F9，XMON-57：就绪闸的解析面——
//     首载未完时按空集走，收窄由调用面的 typeReady 闸统一不激活）。
//   matchesTagFilter：无标签任务恒可见（F1，筛选是附加收窄的裁决面）、
//     多选 = OR 并集（F2）、无法解析的 tagId 不得误配也不命中（F3）、
//     空选中集 = 全量（F4）。
//   buildTagOptions（XMON-57 选项集）：同名去重取投影首行（O1，规范序
//     首个项目的色位——扁平 tagById 丢了 projectId，靠有序投影才判得出）、
//     选项序 = 字典序（O2）、计数只算另一轴（O3，本轴自身的选中不参与）、
//     词表外 tagId 不计入也不凭空造选项（O4）。
//   cardTag（#445 卡片标签解析）：无标签 = null 不占位（C1）、脏/未就绪
//     tagId = null 优雅退化（C2）、多标签只渲染首个可解析项——渲染上限
//     而非数据假设（C3，ADR 0005 Premortem 护栏：github 形态多标签时
//     版面问题交给卡片渲染的上限，不交给词表）。
import { FIXED_TAGS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  buildTagOptions,
  cardTag,
  matchesTagFilter,
  parseTagParam,
} from '../src/board/tag-filter.js';
import type { TagChipData } from '../src/components/ui/tag-chip.js';
import { todo } from './helpers.js';

/** 固定词表名的全序（测试与实现共用同一单源，防词表漂移时假绿）。 */
const NAMES = FIXED_TAGS.map((t) => t.name);

/** id 规约同 fixtures 命名场景：`tag-<name>`。 */
const nameById = new Map(NAMES.map((n) => [`tag-${n}`, n]));

describe('parseTagParam（URL ?tags= 解析）', () => {
  test('缺参/空串/纯分隔符 = 空选（F7）', () => {
    expect(parseTagParam(null, NAMES)).toEqual([]);
    expect(parseTagParam('', NAMES)).toEqual([]);
    expect(parseTagParam(',', NAMES)).toEqual([]);
  });

  test('词表外名混入只留合法名（F5）', () => {
    expect(parseTagParam('foo,bug', NAMES)).toEqual(['bug']);
    expect(parseTagParam('nope', NAMES)).toEqual([]);
  });

  test('词表是动态的：github 形态的真实 label 是合法名，静态表外的名才被丢（F5b）', () => {
    // XMON-57 之前这里是「只认 FIXED_TAGS 六词」——真 label 会被当脏参丢掉。
    const repoVocab = ['area:web', 'bug', 'needs-triage'];
    expect(parseTagParam('needs-triage,bug', repoVocab)).toEqual(['bug', 'needs-triage']);
    expect(parseTagParam('docs', repoVocab)).toEqual([]);
  });

  test('重复名去重（F6）', () => {
    expect(parseTagParam('bug,bug', NAMES)).toEqual(['bug']);
  });

  test('返回序 = 字典序规范序，与参数书写序无关（F8）', () => {
    expect(parseTagParam('docs,bug', NAMES)).toEqual(['bug', 'docs']);
    expect(parseTagParam('refactor,chore,bug', NAMES)).toEqual(['bug', 'chore', 'refactor']);
  });

  test('词表未就绪（vocab = null）= 空集，不把未知名当活选（F9）', () => {
    expect(parseTagParam('bug', null)).toEqual([]);
    expect(parseTagParam('bug', [])).toEqual([]);
  });
});

describe('buildTagOptions（XMON-57 动态词表选项集）', () => {
  const row = (id: string, name: string, color: string): TagChipData => ({ id, name, color });

  test('同名去重，取投影首行（规范序首个项目的色位）（O1）', () => {
    // 投影按 projectIds 字典序 append：p-a 在 p-b 之前，故 bug 取 p-a 的色。
    const options = buildTagOptions(
      [row('a-bug', 'bug', '#aaa'), row('b-bug', 'bug', '#bbb'), row('b-docs', 'docs', '#ccc')],
      [],
      () => true,
      new Map([
        ['a-bug', 'bug'],
        ['b-bug', 'bug'],
        ['b-docs', 'docs'],
      ]),
    );
    expect(options.map((o) => o.name)).toEqual(['bug', 'docs']);
    expect(options[0]?.color).toBe('#aaa');
  });

  test('选项序 = 字典序规范序（与投影书写序无关）（O2）', () => {
    const options = buildTagOptions(
      [row('t-refactor', 'refactor', '#1'), row('t-bug', 'bug', '#2')],
      [],
      () => true,
      new Map([
        ['t-refactor', 'refactor'],
        ['t-bug', 'bug'],
      ]),
    );
    expect(options.map((o) => o.name)).toEqual(['bug', 'refactor']);
  });

  test('计数 = 另一轴收窄后的命中卡数；本轴自身的选中不参与（O3）', () => {
    const bugged = { ...todo(1, 'todo'), tagIds: ['t-bug'] };
    const docced = { ...todo(2, 'todo'), tagIds: ['t-docs'] };
    const untagged = todo(3, 'todo');
    const ordered = [row('t-bug', 'bug', '#f00'), row('t-docs', 'docs', '#0f0')];
    const ids = new Map([
      ['t-bug', 'bug'],
      ['t-docs', 'docs'],
    ]);
    // otherAxis 恒真 = 「另一轴没在收窄」：计数就是全量下的分布。
    const all = buildTagOptions(ordered, [bugged, docced, untagged], () => true, ids);
    expect(all.map((o) => o.count)).toEqual([1, 1]);
    // otherAxis = 只留 docced 所在的那一半：bug 的计数随另一轴落成 0。
    const narrowed = buildTagOptions(
      ordered,
      [bugged, docced, untagged],
      (t) => t.id === docced.id,
      ids,
    );
    expect(narrowed.map((o) => o.count)).toEqual([0, 1]);
    // 不变式：无标签卡不进任何选项的计数（它不因任何类型选项而可见）。
    expect(all.reduce((sum, o) => sum + o.count, 0)).toBe(2);
  });

  test('词表外 tagId 不计入、也不凭空造选项（O4）', () => {
    const stale = { ...todo(1, 'todo'), tagIds: ['t-gone'] };
    const options = buildTagOptions(
      [row('t-bug', 'bug', '#f00')],
      [stale],
      () => true,
      new Map([['t-gone', 'ghost']]),
    );
    expect(options.map((o) => o.name)).toEqual(['bug']);
    expect(options[0]?.count).toBe(0);
  });

  test('空投影 = 空选项（词表未就绪/作用域无标签面）', () => {
    expect(buildTagOptions([], [todo(1, 'todo')], () => true, new Map())).toEqual([]);
  });
});

describe('matchesTagFilter（命中判定，OR + 无标签恒可见）', () => {
  const bugged = { ...todo(1, 'todo'), tagIds: ['tag-bug'] };
  const docced = { ...todo(2, 'todo'), tagIds: ['tag-docs'] };
  const plain = todo(3, 'todo'); // 无标签

  test('空选中集 = 全量可见（F4）', () => {
    for (const t of [bugged, docced, plain]) {
      expect(matchesTagFilter(t, new Set(), nameById)).toBe(true);
    }
  });

  test('无标签任务在任何非空筛选下恒可见（F1）', () => {
    expect(matchesTagFilter(plain, new Set(['bug']), nameById)).toBe(true);
    expect(matchesTagFilter(plain, new Set(NAMES), nameById)).toBe(true);
  });

  test('单选收窄：命中所选名的卡可见，其余 tagged 卡隐（F2 基底）', () => {
    const sel = new Set(['bug']);
    expect(matchesTagFilter(bugged, sel, nameById)).toBe(true);
    expect(matchesTagFilter(docced, sel, nameById)).toBe(false);
  });

  test('多选 = OR 并集，非交集（F2）', () => {
    const sel = new Set(['bug', 'docs']);
    expect(matchesTagFilter(bugged, sel, nameById)).toBe(true);
    expect(matchesTagFilter(docced, sel, nameById)).toBe(true);
  });

  test('无法解析的 tagId（脏数据/竞态）不命中、不误配（F3）', () => {
    const stale = { ...todo(4, 'todo'), tagIds: ['tag-deleted'] };
    expect(matchesTagFilter(stale, new Set(['bug']), nameById)).toBe(false);
    // 混合：可解析命中 + 不可解析共存 = 按可解析的判
    const mixed = { ...todo(5, 'todo'), tagIds: ['tag-deleted', 'tag-bug'] };
    expect(matchesTagFilter(mixed, new Set(['bug']), nameById)).toBe(true);
  });

  test('nameById 缺省时 tagged 卡不命中（首载未就绪的防御面）', () => {
    expect(matchesTagFilter(bugged, new Set(['bug']), new Map())).toBe(false);
    expect(matchesTagFilter(plain, new Set(['bug']), new Map())).toBe(true);
  });
});

describe('cardTag（#445 卡片标签解析，tagId → 渲染行）', () => {
  const tagById = new Map<string, TagChipData>(
    NAMES.map((n) => [`tag-${n}`, { id: `tag-${n}`, name: n, color: `#${n}` }]),
  );

  test('可解析 tagId → 该标签行（name+color 供 TagChip 渲染）', () => {
    const bugged = { ...todo(1, 'todo'), tagIds: ['tag-bug'] };
    expect(cardTag(bugged, tagById)).toEqual({ id: 'tag-bug', name: 'bug', color: '#bug' });
  });

  test('无标签 = null（卡不渲染占位，C1）', () => {
    expect(cardTag(todo(2, 'todo'), tagById)).toBeNull();
  });

  test('脏/未就绪 tagId = null 优雅退化，不误配（C2）', () => {
    const stale = { ...todo(3, 'todo'), tagIds: ['tag-deleted'] };
    expect(cardTag(stale, tagById)).toBeNull();
    expect(cardTag(stale, new Map())).toBeNull();
  });

  test('多标签只取首个可解析项 = 渲染上限（C3）；脏 id 混入跳过后继解析', () => {
    const multi = { ...todo(4, 'todo'), tagIds: ['tag-bug', 'tag-docs'] };
    expect(cardTag(multi, tagById)?.name).toBe('bug');
    const dirtyFirst = { ...todo(5, 'todo'), tagIds: ['tag-deleted', 'tag-docs'] };
    expect(cardTag(dirtyFirst, tagById)?.name).toBe('docs');
  });
});
