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
  {
    section: 'appearance',
    label: '颜色主题',
    keywords: ['theme', 'color', 'colour', 'dark', 'light', 'system', '深色', '浅色', '跟随系统'],
  },
];
