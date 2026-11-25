import type { SettingsSectionId } from './settings-href.js';

export interface SettingsRowEntry {
  section: SettingsSectionId;
  label: string;
  keywords?: string[];
}

export const SETTINGS_ROW_INDEX: SettingsRowEntry[] = [
  {
    section: 'account',
    label: '个人资料',
    keywords: ['account', 'profile', 'name', 'avatar', 'display name', '账号'],
  },
  {
    section: 'account',
    label: '语言',
    keywords: ['language', 'locale', 'zh', 'en', 'chinese', 'english'],
  },
  {
    section: 'account',
    label: '推送通知',
    keywords: [
      'notification',
      'notifications',
      'push',
      'alert',
      'device',
      'lock screen',
      'schedule',
      'schedules',
      'digest',
      '通知',
      '定时',
    ],
  },
  {
    section: 'account',
    label: '颜色主题',
    keywords: [
      'theme',
      'color',
      'colour',
      'dark',
      'light',
      'system',
      'appearance',
      '外观',
      '深色',
      '浅色',
      '跟随系统',
    ],
  },
  {
    section: 'routing',
    label: '模型路由',
    keywords: [
      'model',
      'models',
      'routing',
      'coordinator',
      'effort',
      'thinking',
      '模型',
      '思考强度',
    ],
  },
  {
    section: 'routing',
    label: '服务商',
    keywords: ['provider', 'providers', 'openai', 'anthropic', 'claude', 'codex', 'gemini', 'api'],
  },
  {
    section: 'routing',
    label: '订阅与用量',
    keywords: [
      'subscription',
      'usage',
      'quota',
      'cost',
      'billing',
      'rate limit',
      '订阅',
      '用量',
      '额度',
    ],
  },
  {
    section: 'machines',
    label: '已接入的执行机',
    keywords: ['runner', 'runners', 'machine', 'machines', 'daemon', 'host', '执行机'],
  },
  {
    section: 'machines',
    label: '主机连接与常驻',
    keywords: ['host', 'resident', 'local', 'desktop', 'remote host', '本机常驻'],
  },
  {
    section: 'machines',
    label: '执行机权限',
    keywords: ['permission', 'permissions', 'computer', 'phone', 'sandbox', '权限', '电脑', '手机'],
  },
  {
    section: 'skills',
    label: '技能库',
    keywords: ['skill', 'skills', 'github', 'local', '技能'],
  },
  {
    section: 'skills',
    label: '导入',
    keywords: ['skill', 'import', 'github', 'local', '技能', '导入'],
  },
  {
    section: 'skills',
    label: '新建技能',
    keywords: ['skill', 'new skill', 'create', '技能'],
  },
  {
    section: 'mcp',
    label: 'GitHub',
    keywords: ['github', 'repo', 'repository', 'pr', 'issue', '仓库'],
  },
  {
    section: 'mcp',
    label: 'MCP 连接器',
    keywords: ['mcp', 'composio', 'connector', 'app', 'apps', 'integration', '应用', '工具'],
  },
  {
    section: 'mcp',
    label: '邮箱',
    keywords: ['mail', 'email', 'imap', 'smtp', 'gmail', 'outlook', 'qq', '邮件', '授权码'],
  },
  {
    section: 'mcp',
    label: '本机配置',
    keywords: ['local mcp', 'stdio', '本机'],
  },
  {
    section: 'secrets',
    label: '密钥与环境变量',
    keywords: ['secret', 'secrets', 'env', 'environment', 'variable', '环境变量'],
  },
  {
    section: 'secrets',
    label: '机密',
    keywords: ['secret', 'token', 'encrypted', '机密'],
  },
  {
    section: 'secrets',
    label: '批量添加',
    keywords: ['secret', 'env', 'bulk', 'batch', 'dotenv'],
  },
  {
    section: 'vault',
    label: '网站登录',
    keywords: ['vault', 'password', 'login', 'browser', 'autofill', '保险库', '密码', '代填'],
  },
  {
    section: 'vault',
    label: '网站授权',
    keywords: ['vault', 'authorization', 'grant', 'origin', '保险库', '授权'],
  },
  {
    section: 'vault',
    label: '添加登录',
    keywords: ['vault', 'add login', 'password', 'credential', '保险库'],
  },
  {
    section: 'api-keys',
    label: 'API 密钥',
    keywords: ['api key', 'keys', 'cli', 'mcp', 'git'],
  },
  {
    section: 'api-keys',
    label: '新建 API 密钥',
    keywords: ['api key', 'create key', 'new key'],
  },
  {
    section: 'api-keys',
    label: '令牌',
    keywords: ['api key', 'token', 'cli', 'git', '令牌'],
  },
  {
    section: 'remote',
    label: '配对设备',
    keywords: ['pair', 'pairing', 'qr', 'device', 'phone', 'mobile', '配对', '二维码', '手机'],
  },
  {
    section: 'remote',
    label: '远程访问',
    keywords: ['tailscale', 'remote', 'vpn', 'mesh', '远程'],
  },
  {
    section: 'remote',
    label: '局域网',
    keywords: ['lan', 'local', 'network', 'tunnel', 'relay', 'public', 'remote'],
  },
  {
    section: 'im',
    label: 'Telegram',
    keywords: ['telegram', 'tg', 'bot', 'botfather', 'im', '聊天', '机器人'],
  },
  {
    section: 'im',
    label: 'Slack',
    keywords: ['slack', 'bot', 'workspace', 'im', '聊天'],
  },
  {
    section: 'im',
    label: '微信',
    keywords: ['wechat', 'weixin', 'wx', 'qr', 'im', '聊天'],
  },
  {
    section: 'im',
    label: 'iMessage',
    keywords: ['imessage', 'sms', 'mac', 'bridge', 'im'],
  },
];
