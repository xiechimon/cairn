// 派发技能注入的纯选择层（#1106）：worker 步 claim 时由服务端对「任务文本 ×
// 授予技能目录」做一次规则匹配，选出注入任务 brief 的技能子集。无 I/O、无扫
// 盘——调用方（server machines.ts tryClaim）传入现扫授予集投影，本模块只做
// 归一与规则判定；选择结果（ids + 规则 + 命中原因）随 claim 落 step 行供任务
// 详情面回查（票面验收 4），ids 经 claim 载荷透传 daemon 收窄目录注入。
//
// 规则两档（先精确后意图，误命中的代价 = brief 多一条 description，可逆）：
// - explicit-mention：任务文本报出已授予技能的 id/name（含中文名，#823 同律，
//   ≥2 字符防单字误配）——精度最高，命中即该技能入选择集；
// - domain：域分组双信号——任务文本与技能（id/name/description）命中同一域
//   的关键词（任务侧信号 × 技能侧信号，缺一不可）。域表是词表不是概念扩
//   张：技能仍只有「授予/未授予」两态（#372），域只回答「这次派发提不提它」。
// 零命中 = []（配置事实非故障，调用方零注入不报错）；不保底全量注入。
//
// 边界（票面）：不做向量检索/embedding；不改技能携带/授予模型；description
// 正本仍是用户侧技能根的 SKILL.md frontmatter，cairn 不接管编辑。

import { z } from 'zod';

/** 选择输入的技能投影（server scanLocalSkills 同形子集——授予集已过滤）。 */
export interface SkillInjectCandidate {
  id: string;
  name: string;
  description: string | null;
}

/** 规则 id（wire/DB 持久位；词表演进只加不改语义）。 */
export type SkillInjectRuleId = 'explicit-mention' | 'domain';

export const skillInjectRuleIdSchema = z.enum(['explicit-mention', 'domain']);

/** 单条命中：技能 id + 命中规则 + 人可读原因（详情面直接渲染，至少点名
 *  规则与关键词——票面「至少规则命中原因一条」）。 */
export const skillInjectHitSchema = z.object({
  id: z.string().min(1),
  rule: skillInjectRuleIdSchema,
  reason: z.string().min(1),
});
export type SkillInjectHit = z.infer<typeof skillInjectHitSchema>;

/** 选择结果记录（step 表 skillInjection 列 / steps 读面 wire 形）。hits = []
 * = 已计算零命中（与 null「未计算/旧数据」语义分离）。 */
export const skillInjectionSchema = z.object({
  hits: z.array(skillInjectHitSchema),
});
export type SkillInjectionRecord = z.infer<typeof skillInjectionSchema>;

/** 域分组表（v1：十域起步，任务侧与技能侧共用一套词——双方各自命中同域
 * 关键词即同域）。关键词两类形态各走各的匹配器：
 * - 含 CJK 的关键词 → 归一串 containment（CJK 无词边界）；
 * - 纯拉丁关键词 → token 全等（"test" 不吃 "contest"；复数形词表自带）。
 * 词表演进 = 改本表（调用方零改动）；新增域不动既有域的判定结果。 */
interface SkillInjectDomain {
  id: string;
  label: string;
  keywords: readonly string[];
}

const SKILL_INJECT_DOMAINS: readonly SkillInjectDomain[] = [
  {
    id: 'frontend',
    label: '前端界面',
    keywords: [
      'ui',
      'ux',
      'css',
      '界面',
      '页面',
      '布局',
      '样式',
      '排版',
      '字号',
      '字体',
      '颜色',
      '色彩',
      '组件',
      '按钮',
      '弹层',
      '弹窗',
      '菜单',
      '动画',
      '动效',
      '交互',
      '响应式',
      '前端',
      '无障碍',
      '暗色',
      'frontend',
      'layout',
      'typography',
      'color',
      'colour',
      'button',
      'modal',
      'component',
      'responsive',
      'accessible',
      'animation',
    ],
  },
  {
    id: 'testing',
    label: '测试',
    keywords: [
      'test',
      'tests',
      'testing',
      '测试',
      '单测',
      '单元测试',
      'e2e',
      '断言',
      '回归',
      '覆盖率',
      'coverage',
      'vitest',
      'jest',
      'playwright',
      'tdd',
      '测试用例',
      '测试分层',
    ],
  },
  {
    id: 'debugging',
    label: '调试排障',
    keywords: [
      'bug',
      'bugs',
      '报错',
      '错误',
      '崩溃',
      '失败',
      'debug',
      'debugging',
      '调试',
      '排障',
      '排查',
      '诊断',
      'diagnose',
      'diagnosis',
      'crash',
      '死锁',
      '性能',
      'profile',
      'regression',
      'regressions',
      '故障',
    ],
  },
  {
    id: 'backend',
    label: '后端接口',
    keywords: [
      'api',
      '接口',
      '端点',
      'endpoint',
      'endpoints',
      '路由',
      'route',
      'routes',
      '后端',
      '服务端',
      'middleware',
      '中间件',
      '队列',
      'queue',
      'worker',
      '守护进程',
      'daemon',
      'webhook',
      'sse',
      'websocket',
      'backend',
    ],
  },
  {
    id: 'data',
    label: '数据库与数据',
    keywords: [
      '数据库',
      'database',
      'sql',
      'sqlite',
      'postgres',
      'postgresql',
      'mysql',
      '表结构',
      'schema',
      'migration',
      'migrations',
      '索引',
      '查询',
      'query',
      '缓存',
      'cache',
    ],
  },
  {
    id: 'docs',
    label: '文档写作',
    keywords: [
      '文档',
      'docs',
      'readme',
      '注释',
      '写作',
      '文案',
      '教程',
      'guide',
      '指南',
      'tutorial',
      '博客',
      '翻译',
      'translate',
      'writing',
    ],
  },
  {
    id: 'deploy',
    label: '部署运维',
    keywords: [
      '部署',
      '发布',
      '上线',
      'deploy',
      'deployment',
      'docker',
      'k8s',
      'kubernetes',
      'nginx',
      'systemd',
      '运维',
      '监控',
      'monitor',
      'observability',
      'ci',
      'cd',
      'infrastructure',
    ],
  },
  {
    id: 'security',
    label: '安全',
    keywords: [
      '安全',
      'security',
      '漏洞',
      'xss',
      'csrf',
      '注入攻击',
      '越权',
      'secret',
      '密钥',
      '凭据',
      'credential',
      'credentials',
      'owasp',
      '脱敏',
    ],
  },
  {
    id: 'git',
    label: '版本与协作',
    keywords: [
      '分支',
      'branch',
      'branches',
      '合并',
      'merge',
      'rebase',
      '提交',
      'commit',
      'commits',
      'pr',
      'pull request',
      '冲突',
      'conflict',
      'conflicts',
      'tag',
      'git',
    ],
  },
  {
    id: 'refactor',
    label: '重构清理',
    keywords: [
      '重构',
      'refactor',
      'refactoring',
      '清理',
      'cleanup',
      '死代码',
      '简化',
      'simplify',
      '抽离',
      '拆分',
    ],
  },
];

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;

/** 归一（两形态共用一个 fold）：
 * - spaced：NFKC + 小写 + 非「字母数字/CJK」字符归空格——拉丁词走 token 全等；
 * - compact：spaced 去全部空白——CJK 关键词 containment。 */
function fold(text: string): { spaced: string; compact: string } {
  const spaced = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^0-9a-z㐀-䶿一-鿿豈-﫿]+/g, ' ')
    .trim();
  return { spaced, compact: spaced.replace(/\s+/g, '') };
}

/** 单关键词命中判定：CJK 词 → compact containment；拉丁词 → spaced token
 * 全等（词表自带复数形）。 */
function keywordHits(keyword: string, folded: { spaced: string; compact: string }): boolean {
  if (keyword === '') return false;
  if (CJK_RE.test(keyword)) return folded.compact.includes(keyword);
  const spaced = ` ${folded.spaced} `;
  return spaced.includes(` ${keyword} `);
}

/** 任务的域命中集：domain → 命中的关键词（首个命中词，原因引用）。 */
function domainsOfText(text: string): Map<SkillInjectDomain, string> {
  const out = new Map<SkillInjectDomain, string>();
  if (text.trim() === '') return out;
  const folded = fold(text);
  if (folded.compact === '') return out;
  for (const domain of SKILL_INJECT_DOMAINS) {
    for (const kw of domain.keywords) {
      if (keywordHits(kw, folded)) {
        out.set(domain, kw);
        break;
      }
    }
  }
  return out;
}

/** 技能的域命中集（id/name/description 合并文本）。 */
function domainsOfSkill(skill: SkillInjectCandidate): Map<SkillInjectDomain, string> {
  const text = `${skill.id} ${skill.name} ${skill.description ?? ''}`;
  return domainsOfText(text);
}

/** 显式点名：任务文本（归一）包含技能 id/name（≥2 归一字符，#823 同律）。 */
function mentionsSkill(
  foldedTask: { spaced: string; compact: string },
  skill: SkillInjectCandidate,
): string | null {
  for (const key of [skill.id, skill.name]) {
    const normalized = fold(key);
    if (normalized.compact.length < 2) continue; // 单字名不参与点名（防误配）
    if (foldedTask.compact.includes(normalized.compact)) return key;
  }
  return null;
}

/** 任务文本 → 注入选择（hits 恒为确定性 id 字典序；[] = 已计算零命中）。
 * 候选集（授予集）由调用方界定——本函数不做授权判定，只在候选内选择。 */
export function selectSkillsForTask(
  taskText: string,
  candidates: readonly SkillInjectCandidate[],
): SkillInjectHit[] {
  const foldedTask = fold(taskText);
  const taskDomains = domainsOfText(taskText);
  const hits: SkillInjectHit[] = [];
  for (const skill of candidates) {
    // 规则一：显式点名（精度最高，reason 优先）。
    const mentioned = mentionsSkill(foldedTask, skill);
    if (mentioned !== null) {
      hits.push({
        id: skill.id,
        rule: 'explicit-mention',
        reason: `任务文本显式点名「${mentioned}」`,
      });
      continue;
    }
    // 规则二：域分组双信号（任务侧 ∩ 技能侧命中同一域）。
    if (taskDomains.size > 0) {
      const skillDomains = domainsOfSkill(skill);
      for (const [domain, taskKw] of taskDomains) {
        const skillKw = skillDomains.get(domain);
        if (skillKw !== undefined) {
          hits.push({
            id: skill.id,
            rule: 'domain',
            reason: `任务文本与技能同域「${domain.label}」（任务命中「${taskKw}」，技能描述命中「${skillKw}」）`,
          });
          break;
        }
      }
    }
  }
  return hits.sort((a, b) => a.id.localeCompare(b.id));
}
