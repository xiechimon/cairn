import { describe, expect, it } from 'vitest';
import { type SkillInjectCandidate, selectSkillsForTask } from '../src/index.js';

const granted: SkillInjectCandidate[] = [
  {
    id: 'tdd',
    name: 'tdd',
    description: 'Test-driven development: red-green-refactor, integration tests',
  },
  {
    id: 'better-typography',
    name: 'better-typography',
    description: '产品 UI 排版工程：字号阶梯、字距、换行与截断',
  },
  {
    id: 'better-colors',
    name: 'better-colors',
    description: '颜色系统：ramp 生成、语义 token、对比度实测',
  },
  {
    id: 'diagnosing-bugs',
    name: 'diagnosing-bugs',
    description: 'Diagnosis loop for hard bugs and regressions',
  },
  { id: 'ask-matt', name: 'ask-matt', description: 'Ask which skill or flow fits your situation' },
  {
    id: 'great-resume',
    name: 'great-resume',
    description: '中文求职经历提升：岗位定位、简历要点、HR 开场白',
  },
  { id: 'offer', name: 'offer', description: '中文秋招求职进度管理：投递、筛选、面试进度表' },
  {
    id: 'kami',
    name: 'kami',
    description: '用 Kami 模板排版专业文档：简历、白皮书、信函，产出 PDF',
  },
  { id: 'interview', name: 'interview', description: '中文简历驱动的面试预测、模拟追问和复练技能' },
  { id: 'wiki', name: 'wiki', description: '个人知识沉淀库：存进 wiki、处理 inbox、体检 wiki' },
  { id: 'aihot', name: 'aihot', description: '查 AIHOT 中文 AI 资讯、热点、日报' },
  { id: 'archify', name: 'archify', description: '出架构/流程/时序/数据流/状态图，独立 HTML' },
  {
    id: 'job-apply',
    name: 'job-apply',
    description: '中文求职申请自动填写：读取简历逐项填写招聘网站',
  },
  { id: 'job-match', name: 'job-match', description: '中文岗位匹配分析：JD 对比简历、投递建议' },
  { id: 'evidence-recap', name: 'evidence-recap', description: '把 AI 编程对话复盘为九段证据链' },
  { id: 'project-guide', name: 'project-guide', description: '中文项目导学、源码课程与项目面经' },
  {
    id: 'writing-dna-skill',
    name: 'writing-dna-skill',
    description: '从完整文章蒸馏可复用写作 DNA',
  },
  { id: 'humanizer-zh', name: 'humanizer-zh', description: '编辑中文文章的空话与模板化表达' },
  { id: 'make-resume', name: 'make-resume', description: '中文可编辑简历制作：ASu 模板 HTML/PDF' },
  {
    id: 'scaffold-exercises',
    name: 'scaffold-exercises',
    description: '生成课程练习目录结构并通过 lint',
  },
  {
    id: 'contributor',
    name: 'contributor',
    description: 'GitHub 开源贡献辅助：发现项目、准备 PR、跟踪 CI',
  },
];

describe('zero hits (first exit: [] no throw, zero injection is not a failure)', () => {
  it('empty task text / whitespace = zero hits', () => {
    expect(selectSkillsForTask('', granted)).toEqual([]);
    expect(selectSkillsForTask('   \n\t ', granted)).toEqual([]);
  });
  it('empty candidate set = zero hits', () => {
    expect(selectSkillsForTask('给登录页补 e2e 测试', [])).toEqual([]);
  });
  it('text sharing no domain and no mention with any granted skill = zero hits', () => {
    expect(selectSkillsForTask('把首页轮播图换成静态图', granted)).toEqual([]);
  });
  it('skills with null description do not throw and do not false-match on empty description', () => {
    expect(
      selectSkillsForTask('修一个 bug', [{ id: 'bare', name: 'bare', description: null }]),
    ).toEqual([]);
  });
});

describe('explicit mention (highest precision, wins over domain rules)', () => {
  it('task text naming a skill id/name = that skill hits', () => {
    const hits = selectSkillsForTask('用 tdd 技能给购物车模块补测试', granted);
    expect(hits.map((h) => h.id)).toContain('tdd');
    const tdd = hits.find((h) => h.id === 'tdd');
    expect(tdd?.rule).toBe('explicit-mention');
    expect(tdd?.reason).toContain('tdd');
  });
  it('Chinese names match too (including skills whose frontmatter name is Chinese)', () => {
    const zh = [{ id: 's1', name: '周报助手', description: '帮你写周报' }];
    const hits = selectSkillsForTask('喊周报助手出来写一下本周周报', zh);
    expect(hits.map((h) => h.id)).toEqual(['s1']);
    expect(hits[0]?.rule).toBe('explicit-mention');
  });
  it('single-character names do not participate in mention matching (prevents single-char false matches, same rule as #823)', () => {
    const one = [{ id: 'x', name: 'x', description: '占位' }];
    expect(selectSkillsForTask('x 是什么', one)).toEqual([]);
  });
  it('mentioning a name not granted does not hit (no fabrication; the granted set is the candidate boundary)', () => {
    expect(selectSkillsForTask('用 pdf-polish 排一下版', granted).map((h) => h.id)).not.toContain(
      'pdf-polish',
    );
  });
});

describe('domain-grouping dual signal (task and skill hit the same domain)', () => {
  it('frontend-domain task = frontend-domain skills injected; unrelated skills (job-hunt, knowledge-base, etc.) zero injection', () => {
    const hits = selectSkillsForTask('修复看板卡片的字号过小与换行溢出问题', granted);
    const ids = hits.map((h) => h.id);
    expect(ids).toContain('better-typography');
    expect(ids).toContain('better-colors');
    for (const id of ['great-resume', 'offer', 'wiki', 'interview', 'job-apply', 'aihot']) {
      expect(ids).not.toContain(id);
    }
    const typo = hits.find((h) => h.id === 'better-typography');
    expect(typo?.rule).toBe('domain');
    expect(typo?.reason).toContain('前端');
    expect(typo?.reason).toContain('字号');
  });
  it('English task text follows the same domain matching (token level, substring does not count)', () => {
    const hits = selectSkillsForTask('Add vitest coverage for the claim API endpoint', granted);
    const ids = hits.map((h) => h.id);
    expect(ids).toContain('tdd');
    expect(ids).not.toContain('better-typography');
    expect(
      selectSkillsForTask('run the contest', [
        { id: 'tdd', name: 'tdd', description: 'Test-driven development' },
      ]),
    ).toEqual([]);
  });
  it('Chinese task in the test domain (same shape as acceptance 1)', () => {
    const hits = selectSkillsForTask('给购物车结算流程补单测与回归断言', granted);
    const ids = hits.map((h) => h.id);
    expect(ids).toContain('tdd');
    expect(ids).not.toContain('ask-matt');
  });
  it('multi-domain hit = union (skills of each domain injected when the task spans domains)', () => {
    const hits = selectSkillsForTask('给部署脚本补安全扫描的单元测试', granted);
    const ids = hits.map((h) => h.id);
    expect(ids).toContain('tdd');
    expect(ids).toContain('contributor');
  });
});

describe('output shape (determinism + explainability)', () => {
  it('determinism: two calls with the same input byte-identical, ordered by id', () => {
    const a = selectSkillsForTask('用 tdd 给字号问题补测试', granted);
    const b = selectSkillsForTask('用 tdd 给字号问题补测试', granted);
    expect(a).toEqual(b);
    const ids = a.map((h) => h.id);
    expect([...ids].sort((x, y) => x.localeCompare(y))).toEqual(ids);
  });
  it('the same skill emits only one entry (explicit mention wins over domain, no duplicates)', () => {
    const hits = selectSkillsForTask('用 tdd 技能给购物车模块补单元测试', granted);
    expect(hits.filter((h) => h.id === 'tdd').length).toBe(1);
  });
  it('every hit carries rule and reason (acceptance 4: at least one rule-hit reason)', () => {
    const hits = selectSkillsForTask('修复看板卡片的字号过小', granted);
    for (const h of hits) {
      expect(['explicit-mention', 'domain']).toContain(h.rule);
      expect(h.reason.length).toBeGreaterThan(0);
    }
  });
  it('fullwidth/halfwidth punctuation and case normalized, still matches (same NFKC rule)', () => {
    expect(selectSkillsForTask('修复看板卡片的字号过小', granted).map((h) => h.id)).toEqual(
      selectSkillsForTask('修复看板卡片（字号）过小！！', granted).map((h) => h.id),
    );
    expect(selectSkillsForTask('Add Vitest Coverage', granted).map((h) => h.id)).toEqual(
      selectSkillsForTask('add VITEST coverage', granted).map((h) => h.id),
    );
  });
});

describe('20+ skill noise gate (negative-case list from ticket acceptance 1)', () => {
  it('job-hunt / knowledge-base / tutorial-family skills zero injection in any engineering task', () => {
    const engineering = [
      '重构 dispatch 模块并补 vitest 覆盖',
      '修复 claim 端点报错：404 排查',
      '给按钮组件加动效与暗色适配',
    ];
    for (const text of engineering) {
      const ids = selectSkillsForTask(text, granted).map((h) => h.id);
      for (const id of [
        'great-resume',
        'offer',
        'interview',
        'job-apply',
        'job-match',
        'make-resume',
        'wiki',
        'aihot',
        'project-guide',
        'evidence-recap',
        'writing-dna-skill',
        'humanizer-zh',
      ]) {
        expect(ids).not.toContain(id);
      }
    }
  });
});

describe('explicit mention: bounded and every occurrence (#1969)', () => {
  const wikiNull: SkillInjectCandidate = { id: 'wiki', name: 'wiki', description: null };
  const prNull: SkillInjectCandidate = { id: 'pr', name: 'pr', description: null };
  const variantNull: SkillInjectCandidate = { id: 'variant', name: 'variant', description: null };
  const mentionCues = ['use', 'with', 'skill', '/', '调用', '用'] as const;
  const grantedWithNullWiki = [
    ...granted.filter((s) => s.id !== 'wiki'),
    wikiNull,
    prNull,
    variantNull,
  ];

  it('"Use wiki" selects wiki once with rule explicit-mention', () => {
    const hits = selectSkillsForTask('Use wiki', grantedWithNullWiki);
    const wikiHits = hits.filter((h) => h.id === 'wiki');
    expect(wikiHits).toHaveLength(1);
    expect(wikiHits[0]?.rule).toBe('explicit-mention');
  });

  it('"The wiki needs updating. Use wiki" selects wiki once with rule explicit-mention', () => {
    const hits = selectSkillsForTask('The wiki needs updating. Use wiki', grantedWithNullWiki);
    const wikiHits = hits.filter((h) => h.id === 'wiki');
    expect(wikiHits).toHaveLength(1);
    expect(wikiHits[0]?.rule).toBe('explicit-mention');
  });

  it('"the wiki page is stale" alone produces no explicit-mention hit for a single-token name', () => {
    const hits = selectSkillsForTask('the wiki page is stale', [wikiNull]);
    expect(hits.filter((h) => h.rule === 'explicit-mention')).toEqual([]);
    expect(hits.map((h) => h.id)).not.toContain('wiki');
  });

  it('"reproduce the crash" does not select pr; "fix buttonVariants spacing" does not select variant', () => {
    expect(selectSkillsForTask('reproduce the crash', [prNull])).toEqual([]);
    expect(selectSkillsForTask('fix buttonVariants spacing', [variantNull])).toEqual([]);
  });

  it('"use the pr skill" and "/pr" select pr (cues: use, with, skill, /, 调用, 用)', () => {
    expect(mentionCues).toEqual(['use', 'with', 'skill', '/', '调用', '用']);
    const withSkill = selectSkillsForTask('use the pr skill', [prNull]);
    expect(withSkill).toEqual([expect.objectContaining({ id: 'pr', rule: 'explicit-mention' })]);
    const slash = selectSkillsForTask('/pr', [prNull]);
    expect(slash).toEqual([expect.objectContaining({ id: 'pr', rule: 'explicit-mention' })]);
  });

  it('multi-token names (better-typography, "better typography") still select on mention without a cue', () => {
    const multi = [
      {
        id: 'better-typography',
        name: 'better-typography',
        description: null,
      },
    ];
    const hyphen = selectSkillsForTask('apply better-typography here', multi);
    expect(hyphen).toEqual([
      expect.objectContaining({ id: 'better-typography', rule: 'explicit-mention' }),
    ]);
    const spaced = selectSkillsForTask('apply better typography here', multi);
    expect(spaced).toEqual([
      expect.objectContaining({ id: 'better-typography', rule: 'explicit-mention' }),
    ]);
  });

  it('Chinese name mention keeps current behavior', () => {
    const zh = [{ id: 's1', name: '周报助手', description: '帮你写周报' }];
    const hits = selectSkillsForTask('喊周报助手出来写一下本周周报', zh);
    expect(hits.map((h) => h.id)).toEqual(['s1']);
    expect(hits[0]?.rule).toBe('explicit-mention');
  });

  it('a task that both names a skill and hits its domain yields one explicit-mention hit, not domain', () => {
    const hits = selectSkillsForTask('用 tdd 技能给购物车模块补单元测试', granted);
    const tdd = hits.filter((h) => h.id === 'tdd');
    expect(tdd).toHaveLength(1);
    expect(tdd[0]?.rule).toBe('explicit-mention');
  });

  it('matching on name works when id differs', () => {
    const renamed = [{ id: 'x-1', name: 'wiki', description: null }];
    const hits = selectSkillsForTask('Use wiki', renamed);
    expect(hits).toEqual([
      expect.objectContaining({
        id: 'x-1',
        rule: 'explicit-mention',
        reason: expect.stringContaining('wiki'),
      }),
    ]);
  });

  it('output order stays sorted by id for the new cases', () => {
    const mixed: SkillInjectCandidate[] = [
      variantNull,
      wikiNull,
      prNull,
      { id: 'aaa-skill', name: 'wiki', description: null },
    ];
    const hits = selectSkillsForTask('Use wiki with the pr skill', mixed);
    const ids = hits.map((h) => h.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    expect(ids).toContain('wiki');
    expect(ids).toContain('pr');
    expect(ids).toContain('aaa-skill');
  });
});
