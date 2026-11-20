import { z } from 'zod';
import { thinkingLevelSchema } from '../thinking-levels.js';
import { epochMs, recordId } from './common.js';
import { workerBriefTextSchema } from './worker-brief-text.js';

export const PROJECT_REPO_KINDS = ['hosted', 'github', 'local'] as const;
export const evidenceStoreSchema = z.enum(['attachments', 'repository']);
export type EvidenceStore = z.infer<typeof evidenceStoreSchema>;
export const SPLIT_POLICIES = ['human', 'shadow', 'auto'] as const;
export const splitPolicySchema = z.enum(SPLIT_POLICIES);
export type SplitPolicy = z.infer<typeof splitPolicySchema>;
export const projectRepoKindSchema = z.enum(PROJECT_REPO_KINDS);
export type ProjectRepoKind = z.infer<typeof projectRepoKindSchema>;

export const PROJECT_ICONS = [
  'folder',
  'code',
  'terminal',
  'database',
  'flask-conical',
  'box',
  'globe',
  'book-open',
  'leaf',
  'mountain',
  'rocket',
  'zap',
  'chart-column',
  'heart',
  'star',
  'layers',
  'cpu',
  'cloud',
  'server',
  'smartphone',
  'palette',
  'pen-tool',
  'bug',
  'shield',
  'key',
  'wrench',
  'git-branch',
  'package',
  'music',
  'camera',
  'map',
  'graduation-cap',
  'git-fork',
  'git-merge',
  'braces',
  'binary',
  'file-code',
  'folder-git',
  'hash',
  'container',
  'hard-drive',
  'laptop',
  'keyboard',
  'circuit-board',
  'memory-stick',
  'network',
  'rss',
  'webhook',
  'workflow',
  'activity',
  'gauge',
  'atom',
  'microscope',
  'dna',
  'brain',
  'orbit',
  'droplet',
  'waves',
  'wind',
  'snowflake',
  'sun',
  'moon',
  'flame',
  'tree-pine',
  'sprout',
  'bird',
  'cat',
  'dog',
  'fish',
  'anchor',
  'sailboat',
  'plane',
  'car',
  'bike',
  'compass',
  'map-pin',
  'flag',
  'trophy',
  'medal',
  'target',
  'lightbulb',
  'puzzle',
  'gamepad-2',
  'dices',
  'ghost',
  'bot',
  'magnet',
  'umbrella',
  'image',
  'film',
  'headphones',
  'guitar',
  'clapperboard',
  'aperture',
  'castle',
  'coffee',
] as const;
export const projectIconSchema = z.enum(PROJECT_ICONS);
export type ProjectIcon = z.infer<typeof projectIconSchema>;

const AUTO_ICON_DOMAIN = PROJECT_ICONS.filter((name) => name !== 'box');

export function projectIconForName(name: string): ProjectIcon {
  let state = 2166136261;
  for (const char of name) {
    state ^= char.codePointAt(0) ?? 0;
    state = Math.imul(state, 16777619);
  }
  state = state >>> 0 || 1;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return AUTO_ICON_DOMAIN[(state >>> 0) % AUTO_ICON_DOMAIN.length] ?? 'box';
}

export function projectIconOrAuto(
  icon: ProjectIcon | null | undefined,
  name: string | null | undefined,
): ProjectIcon {
  if (icon != null) return icon;
  const trimmed = name?.trim() ?? '';
  return trimmed === '' ? 'box' : projectIconForName(trimmed);
}

export const PROJECT_ICON_KEYWORDS: Record<ProjectIcon, readonly string[]> = {
  folder: ['文件夹', '目录', 'folder', 'directory'],
  code: ['代码', '编程', 'code', 'brackets', 'dev'],
  terminal: ['终端', '命令行', 'terminal', 'console', 'shell'],
  database: ['数据库', '存储', 'database', 'db', 'storage'],
  'flask-conical': ['实验', '科学', '烧瓶', 'flask', 'science', 'lab', 'experiment'],
  box: ['盒子', 'box', 'default'],
  globe: ['地球', '全球', '世界', 'globe', 'world', 'web', 'international'],
  'book-open': ['书', '文档', '阅读', 'book', 'docs', 'read', 'documentation'],
  leaf: ['叶子', '自然', '环保', 'leaf', 'nature', 'green'],
  mountain: ['山', '户外', 'mountain', 'peak', 'outdoor', 'hiking'],
  rocket: ['火箭', '发射', 'rocket', 'launch', 'ship'],
  zap: ['闪电', '快', 'zap', 'bolt', 'fast', 'energy'],
  'chart-column': ['图表', '统计', '柱状图', 'chart', 'stats', 'analytics', 'bar'],
  heart: ['心', '喜欢', 'love', 'heart', 'like', 'favorite'],
  star: ['星', '收藏', 'star', 'favorite', 'bookmark'],
  layers: ['层', '堆栈', 'layers', 'stack'],
  cpu: ['芯片', '处理器', 'cpu', 'chip', 'processor', 'hardware'],
  cloud: ['云', 'cloud', 'sky'],
  server: ['服务器', '主机', 'server', 'backend', 'host'],
  smartphone: ['手机', '移动', 'smartphone', 'mobile', 'phone'],
  palette: ['调色板', '设计', '美术', 'palette', 'design', 'art', 'color'],
  'pen-tool': ['钢笔', '画图', '设计', 'pen', 'draw', 'design'],
  bug: ['虫', '调试', 'bug', 'debug', 'insect'],
  shield: ['盾', '安全', '防护', 'shield', 'security', 'protect'],
  key: ['钥匙', '密钥', 'key', 'password', 'access', 'auth'],
  wrench: ['扳手', '工具', '修理', 'wrench', 'tool', 'fix', 'repair'],
  'git-branch': ['分支', 'git', 'branch', 'version'],
  package: ['包', '包裹', 'package', 'npm', 'module'],
  music: ['音乐', '歌曲', 'music', 'audio', 'song', 'sound'],
  camera: ['相机', '拍照', '照片', 'camera', 'photo'],
  map: ['地图', 'map', 'location', 'atlas'],
  'graduation-cap': ['毕业', '学习', '教育', '学校', 'graduation', 'education', 'school', 'learn'],
  'git-fork': ['分叉', 'fork', 'git', '分支'],
  'git-merge': ['合并', 'merge', 'git', '合流'],
  braces: ['大括号', '花括号', 'braces', 'json', 'object'],
  binary: ['二进制', 'binary', 'bits', '01'],
  'file-code': ['代码文件', 'file', 'code', 'script', 'source'],
  'folder-git': ['仓库', 'git 文件夹', 'repo', 'repository', 'folder'],
  hash: ['井号', '标签', 'hash', 'tag', 'number'],
  container: ['容器', 'docker', 'container', 'deploy'],
  'hard-drive': ['硬盘', '磁盘', 'hard drive', 'disk', 'storage'],
  laptop: ['笔记本', '电脑', 'laptop', 'computer', 'macbook'],
  keyboard: ['键盘', '输入', 'keyboard', 'typing', 'input'],
  'circuit-board': ['电路板', '硬件', 'circuit', 'board', 'electronics', 'iot'],
  'memory-stick': ['内存', '存储条', 'memory', 'ram', 'stick'],
  network: ['网络', '连接', 'network', 'graph', 'nodes'],
  rss: ['订阅', 'rss', 'feed', '播客'],
  webhook: ['钩子', '回调', 'webhook', 'hook', 'integration'],
  workflow: ['工作流', '流程', 'workflow', 'pipeline', 'automation'],
  activity: ['活动', '脉搏', '监控', 'activity', 'pulse', 'monitor', 'health'],
  gauge: ['仪表盘', '速度', 'gauge', 'dashboard', 'speed', 'metrics'],
  atom: ['原子', '物理', 'atom', 'react', 'physics'],
  microscope: ['显微镜', '研究', 'microscope', 'research', 'biology'],
  dna: ['基因', 'dna', 'genetics', 'biology', '生物'],
  brain: ['大脑', '智能', 'brain', 'ai', 'mind', 'thinking'],
  orbit: ['轨道', '环绕', 'orbit', 'satellite', 'space'],
  droplet: ['水滴', '液体', 'droplet', 'water', 'drop'],
  waves: ['波浪', '海浪', 'waves', 'ocean', 'water'],
  wind: ['风', 'wind', 'breeze', 'air'],
  snowflake: ['雪花', '冬天', 'snowflake', 'snow', 'winter', 'cold'],
  sun: ['太阳', '晴天', 'sun', 'sunny', 'day'],
  moon: ['月亮', '夜晚', 'moon', 'night'],
  flame: ['火焰', '热', 'flame', 'fire', 'hot'],
  'tree-pine': ['松树', '树', 'pine', 'tree', 'forest'],
  sprout: ['发芽', '成长', 'sprout', 'grow', 'plant', 'seed'],
  bird: ['鸟', 'bird', 'twitter', 'fly'],
  cat: ['猫', 'cat', 'pet', 'kitten'],
  dog: ['狗', 'dog', 'pet', 'puppy'],
  fish: ['鱼', 'fish', 'ocean', 'sea'],
  anchor: ['锚', 'anchor', 'navy', 'ship', 'sea'],
  sailboat: ['帆船', '航海', 'sailboat', 'sail', 'boat'],
  plane: ['飞机', '旅行', 'plane', 'flight', 'travel', 'air'],
  car: ['汽车', 'car', 'vehicle', 'drive'],
  bike: ['自行车', 'bike', 'bicycle', 'cycling'],
  compass: ['指南针', '方向', 'compass', 'navigation', 'explore'],
  'map-pin': ['定位', '地点', 'pin', 'location', 'place'],
  flag: ['旗', '标记', 'flag', 'milestone', 'marker'],
  trophy: ['奖杯', '冠军', 'trophy', 'winner', 'achievement'],
  medal: ['奖牌', 'medal', 'award', 'prize'],
  target: ['目标', '靶心', 'target', 'goal', 'aim'],
  lightbulb: ['灯泡', '想法', 'lightbulb', 'idea', 'insight'],
  puzzle: ['拼图', '插件', 'puzzle', 'plugin', 'piece'],
  'gamepad-2': ['游戏', '手柄', 'gamepad', 'game', 'gaming', 'controller'],
  dices: ['骰子', '随机', 'dices', 'dice', 'random', 'game'],
  ghost: ['幽灵', 'ghost', 'spooky', 'fun'],
  bot: ['机器人', 'bot', 'robot', 'agent'],
  magnet: ['磁铁', '吸引', 'magnet', 'attract'],
  umbrella: ['雨伞', '保护', 'umbrella', 'rain', 'protect'],
  image: ['图片', '图像', 'image', 'picture', 'gallery'],
  film: ['电影', '胶片', 'film', 'movie', 'video'],
  headphones: ['耳机', '音频', 'headphones', 'audio', 'listen'],
  guitar: ['吉他', '乐器', 'guitar', 'instrument', 'band'],
  clapperboard: ['场记板', '视频', 'clapperboard', 'movie', 'film', 'production'],
  aperture: ['光圈', '摄影', 'aperture', 'photography', 'lens'],
  castle: ['城堡', '建筑', 'castle', 'fortress', 'build'],
  coffee: ['咖啡', 'coffee', 'cafe', 'drink', 'java'],
};

export function searchProjectIcons(query: string): ProjectIcon[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...PROJECT_ICONS];
  const kebab = needle.replaceAll(' ', '-');
  return PROJECT_ICONS.filter(
    (name) =>
      name.includes(kebab) ||
      PROJECT_ICON_KEYWORDS[name].some((k) => k.toLowerCase().includes(needle)),
  );
}

export const PROJECT_COLORS = ['moss', 'amber', 'slate', 'plum', 'teal', 'rose', 'gray'] as const;
export const projectColorSchema = z.enum(PROJECT_COLORS);
export type ProjectColor = z.infer<typeof projectColorSchema>;

export const PROJECT_GOAL_MAX = 8_000;

export const projectModelChoiceSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  thinkingLevel: thinkingLevelSchema.nullable(),
});
export type ProjectModelChoice = z.infer<typeof projectModelChoiceSchema>;

export const projectModelOverridesSchema = z.object({
  coordinator: projectModelChoiceSchema.optional(),
});
export type ProjectModelOverrides = z.infer<typeof projectModelOverridesSchema>;
export type ProjectModelUse = keyof ProjectModelOverrides;

export const projectRecordSchema = z.object({
  id: recordId,
  name: z.string(),
  group: z.string().nullable().optional(),
  teamId: recordId,
  splitPolicy: splitPolicySchema.default('human'),
  evidenceStore: evidenceStoreSchema.default('attachments'),
  description: z.string().optional(),
  instructions: z.string().optional(),
  maxConcurrent: z.number().int().optional(),
  repoKind: projectRepoKindSchema.optional(),
  repoName: z.string().optional(),
  githubRepo: z.string().optional(),
  localPath: z.string().optional(),
  baseBranch: z.string().nullable().optional(),
  icon: projectIconSchema.nullable().optional(),
  color: projectColorSchema.nullable().optional(),
  archivedAt: epochMs.nullable().optional(),
  modelOverrides: projectModelOverridesSchema.optional(),
  localChecks: z.array(z.string().min(1)).optional(),
  cloneUrl: z.string().optional(),
});
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const projectMergeConfigSchema = z.object({
  planAutoApproveEnabled: z.boolean().default(true),
  localChecks: z.array(z.string().min(1)).default([]),
});
export type ProjectMergeConfig = z.infer<typeof projectMergeConfigSchema>;
export const githubRepoRefSchema = z.object({
  owner: z.string(),
  repo: z.string(),
});
export type GithubRepoRef = z.infer<typeof githubRepoRefSchema>;

export function parseGithubRepoRef(value: string): GithubRepoRef | null {
  const m = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(value);
  const owner = m?.[1];
  const repo = m?.[2];
  if (owner === undefined || repo === undefined) return null;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

export function isGithubRepoRef(value: string): boolean {
  return parseGithubRepoRef(value) !== null;
}

const GITHUB_REPO_INPUT_URL =
  /^(?:(?:https?|ssh):\/\/)?(?:www\.|git@)?github\.com[:/]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i;

export function parseGithubRepoInput(value: string): GithubRepoRef | null {
  const direct = parseGithubRepoRef(value);
  if (direct !== null) return direct;
  const m = GITHUB_REPO_INPUT_URL.exec(value);
  if (m === null) return null;
  return parseGithubRepoRef(`${m[1]}/${m[2]}`);
}

export function githubRepoInputToRef(value: string): string | null {
  const ref = parseGithubRepoInput(value);
  return ref === null ? null : `${ref.owner}/${ref.repo}`;
}

export const createProjectBodySchema = z.object({
  name: z.string(),
  teamId: z.string().optional(),
  kind: projectRepoKindSchema.optional(),
  repoKind: projectRepoKindSchema.optional(),
  localPath: z.string().nullish(),
  githubRepo: z.union([z.string(), githubRepoRefSchema]).optional(),
});
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export const PROJECT_MAX_CONCURRENT = 16;

export const patchProjectBodySchema = z
  .object({
    name: z.string().optional(),
    group: z.string().trim().min(1).nullable().optional(),
    splitPolicy: splitPolicySchema.optional(),
    evidenceStore: evidenceStoreSchema.optional(),
    description: z.string().max(PROJECT_GOAL_MAX).nullish(),
    instructions: workerBriefTextSchema.nullish(),
    modelOverrides: z
      .object({
        coordinator: projectModelChoiceSchema.nullable().optional(),
      })
      .strict()
      .optional(),
    maxConcurrent: z.number().int().min(1).max(PROJECT_MAX_CONCURRENT).nullable().optional(),
    repoKind: projectRepoKindSchema.optional(),
    githubRepo: z.string().optional(),
    icon: projectIconSchema.nullable().optional(),
    color: projectColorSchema.nullable().optional(),
    baseBranch: z
      .string()
      .trim()
      .min(1)
      .refine(
        (branch) =>
          branch !== 'HEAD' &&
          branch !== '@' &&
          !branch.startsWith('-') &&
          !branch.endsWith('.') &&
          !branch.includes('..') &&
          !branch.includes('@{') &&
          !/[~^:?*[\\\s]/u.test(branch) &&
          Array.from(branch).every(
            (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
          ) &&
          branch
            .split('/')
            .every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock')),
        'Expected a Git branch name',
      )
      .nullable()
      .optional(),
  })
  .strict();
export type PatchProjectBody = z.infer<typeof patchProjectBodySchema>;

export const PROJECT_LOCAL_ERROR_REASONS = ['not_found', 'not_git', 'not_absolute'] as const;
export type LocalErrorReason = (typeof PROJECT_LOCAL_ERROR_REASONS)[number];

export const LOCAL_ERROR_REASON_COPY: LocalErrorReasonMap<string> = {
  not_found: '路径不存在',
  not_git: '不是 git 仓库',
  not_absolute: '需要绝对路径',
};

export type LocalErrorBody = { error: string; reason?: LocalErrorReason };

export type LocalErrorReasonMap<T> = Record<LocalErrorReason, T>;

export const projectFilesResponseSchema = z.object({
  ref: z.string(),
  commit: z.string(),
  truncated: z.boolean(),
  files: z.array(
    z.object({
      path: z.string(),
      type: z.enum(['blob', 'tree']),
      size: z.number().int().nullable(),
    }),
  ),
});
export type ProjectFilesResponse = z.infer<typeof projectFilesResponseSchema>;

export const projectFileResponseSchema = z.object({
  ref: z.string(),
  commit: z.string(),
  path: z.string(),
  size: z.number().int(),
  encoding: z.enum(['utf-8', 'base64']),
  content: z.string(),
});
export type ProjectFileResponse = z.infer<typeof projectFileResponseSchema>;

export const projectBranchesResponseSchema = z.object({
  defaultBranch: recordId.nullable(),
  branches: z.array(
    z.object({
      name: z.string(),
      isDefault: z.boolean(),
    }),
  ),
});
export type ProjectBranchesResponse = z.infer<typeof projectBranchesResponseSchema>;
