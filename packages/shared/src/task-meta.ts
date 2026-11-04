import { ATTACHMENT_TOKEN_LINE, renderAttachmentTokensToLabels } from './attachment-token.js';

export const PLACEHOLDER_TITLE_FALLBACK = '未命名任务';

export function derivePlaceholderTitle(spec: string): string {
  let fallback = '';
  for (const raw of spec.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const token = ATTACHMENT_TOKEN_LINE.exec(line);
    if (token !== null) {
      if (fallback === '') fallback = token[1] ?? '';
      continue;
    }
    const rendered = renderAttachmentTokensToLabels(line);
    if (rendered === '') continue;
    return rendered.length > 50 ? `${rendered.slice(0, 50)}…` : rendered;
  }
  return fallback.length > 50 ? `${fallback.slice(0, 50)}…` : fallback;
}

export interface FixedTag {
  readonly name: string;
  readonly description: string;
  readonly color: string;
}

export const FIXED_TAGS: readonly FixedTag[] = [
  { name: 'bug', description: '修坏的东西', color: '#ef4444' },
  { name: 'feature', description: '新功能', color: '#8b5cf6' },
  { name: 'improvement', description: '改进既有功能', color: '#3b82f6' },
  { name: 'refactor', description: '重构（不改行为）', color: '#f59e0b' },
  { name: 'docs', description: '文档', color: '#0ea5e9' },
  { name: 'chore', description: '杂务/依赖/配置', color: '#71717a' },
];
