import type { SettingsSectionId } from './settings-href.js';

export interface SettingsRowEntry {
  section: SettingsSectionId;
  label: string;
  keywords?: string[];
}

export const SETTINGS_ROW_INDEX: SettingsRowEntry[] = [
  {
    section: 'machines',
    label: '使用我自己的 agent 配置',
    keywords: [
      'agent config',
      'claude code',
      'hooks',
      'skills',
      'mcp',
      '钩子',
      '全局指令',
      'CLAUDE.md',
      'AGENTS.md',
    ],
  },
  { section: 'account', label: '语言', keywords: ['language', 'locale'] },
  {
    section: 'account',
    label: '对外动作',
    keywords: [
      'external actions',
      'action tier',
      'approval',
      'approve',
      '对外动作',
      '先问我',
      '完全放手',
    ],
  },
  { section: 'account', label: '推送通知', keywords: ['notification', 'push'] },
  {
    section: 'account',
    label: '提醒声音',
    keywords: ['notification', 'sound', '提醒声音', '无声'],
  },
  {
    section: 'account',
    label: '在这台设备上接收推送',
    keywords: ['notification', 'push', 'device'],
  },
  {
    section: 'appearance',
    label: '颜色主题',
    keywords: ['theme', 'color', 'colour', 'dark', 'light', 'system', '深色', '浅色', '跟随系统'],
  },
];
