import type { ClaudeLoginNotice } from '@cairn/shared';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function formatClaudeLoginWarning(
  notice: ClaudeLoginNotice,
  name: string,
  t: Translate,
): string {
  if (notice.kind === 'expired') {
    return t('{name} 上的 Claude Code 登录已过期。在该机器上运行 `claude auth login` 重新登录。', {
      name,
    });
  }
  if (notice.days === null) {
    return t(
      '{name} 上的 Claude Code 登录将在不到 1 天内过期。在该机器上运行 `claude auth login` 重新登录。',
      { name },
    );
  }
  if (notice.days === 1) {
    return t(
      '{name} 上的 Claude Code 登录将在 1 天后过期。在该机器上运行 `claude auth login` 重新登录。',
      { name },
    );
  }
  return t(
    '{name} 上的 Claude Code 登录将在 {days} 天后过期。在该机器上运行 `claude auth login` 重新登录。',
    { name, days: notice.days },
  );
}
