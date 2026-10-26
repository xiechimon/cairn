import { z } from 'zod';

export interface SkillInjectCandidate {
  id: string;
  name: string;
  description: string | null;
}

export type SkillInjectRuleId = 'explicit-mention' | 'domain';

export const skillInjectRuleIdSchema = z.enum(['explicit-mention', 'domain']);

export const skillInjectHitSchema = z.object({
  id: z.string().min(1),
  rule: skillInjectRuleIdSchema,
  reason: z.string().min(1),
});
export type SkillInjectHit = z.infer<typeof skillInjectHitSchema>;

export const skillInjectionSchema = z.object({
  hits: z.array(skillInjectHitSchema),
});
export type SkillInjectionRecord = z.infer<typeof skillInjectionSchema>;

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
      '崩溃',
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

const MENTION_CUES = new Set(['用', 'use', 'skill', 'skills', '技能']);

function fold(text: string): { spaced: string; compact: string } {
  const spaced = text
    .replace(/https?:\/\/[^\s)>\]]+/gi, ' ')
    .replace(/(?:[\w.@+-]+\/)+[\w.@+-]+/g, ' ')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^0-9a-z㐀-䶿一-鿿豈-﫿]+/g, ' ')
    .trim();
  return { spaced, compact: spaced.replace(/\s+/g, '') };
}

function keywordHits(keyword: string, folded: { spaced: string; compact: string }): boolean {
  if (keyword === '') return false;
  if (CJK_RE.test(keyword)) return folded.compact.includes(keyword);
  const spaced = ` ${folded.spaced} `;
  return spaced.includes(` ${keyword} `);
}

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

function domainsOfSkill(skill: SkillInjectCandidate): Map<SkillInjectDomain, string> {
  const text = `${skill.id} ${skill.name} ${skill.description ?? ''}`;
  return domainsOfText(text);
}

function mentionsSkill(
  foldedTask: { spaced: string; compact: string },
  skill: SkillInjectCandidate,
): string | null {
  const hay = foldedTask.spaced.split(' ').filter((token) => token !== '');
  for (const key of [skill.id, skill.name]) {
    const normalized = fold(key);
    if (normalized.compact.length < 2) continue;
    if (CJK_RE.test(key)) {
      if (foldedTask.compact.includes(normalized.compact)) return key;
      continue;
    }
    const needle = normalized.spaced.split(' ').filter((token) => token !== '');
    let at = -1;
    for (let i = 0; i + needle.length <= hay.length; i++) {
      let matches = needle.length > 0;
      for (let j = 0; j < needle.length; j++) {
        if (hay[i + j] !== needle[j]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        at = i;
        break;
      }
    }
    if (at < 0) continue;
    const declared =
      needle.length >= 2 ||
      MENTION_CUES.has(hay[at - 1] ?? '') ||
      MENTION_CUES.has(hay[at + needle.length] ?? '');
    if (declared) return key;
  }
  return null;
}

export function selectSkillsForTask(
  taskText: string,
  candidates: readonly SkillInjectCandidate[],
): SkillInjectHit[] {
  const foldedTask = fold(taskText);
  const taskDomains = domainsOfText(taskText);
  const hits: SkillInjectHit[] = [];
  for (const skill of candidates) {
    const mentioned = mentionsSkill(foldedTask, skill);
    if (mentioned !== null) {
      hits.push({
        id: skill.id,
        rule: 'explicit-mention',
        reason: `任务文本显式点名「${mentioned}」`,
      });
      continue;
    }
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
