import type { SettingsSectionId } from './settings-href.js';

export interface SettingsRowEntry {
  section: SettingsSectionId;
  label: string;
  keywords?: string[];
}

export const SETTINGS_ROW_INDEX: SettingsRowEntry[] = [
  { section: 'account', label: '语言', keywords: ['language', 'locale'] },
  { section: 'account', label: '推送通知', keywords: ['notification', 'push'] },
  {
    section: 'account',
    label: '在这台设备上接收推送',
    keywords: ['notification', 'push', 'device'],
  },
  { section: 'account', label: '人工共同作者署名', keywords: ['co-author', 'commit'] },
  { section: 'account', label: '邀请任务发起人审阅', keywords: ['review', 'pr'] },
  { section: 'account', label: '首个 PR 社区提示', keywords: ['pr', 'share'] },
  {
    section: 'appearance',
    label: '颜色主题',
    keywords: ['theme', 'color', 'colour', 'dark', 'light', 'system', '深色', '浅色', '跟随系统'],
  },
];
