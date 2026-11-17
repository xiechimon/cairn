export const PICKED_PROJECT_OPEN = '【输入框选定项目：';

export const PROJECT_INSTRUCTIONS_HEADING = '## 项目说明（';

export const PROJECT_MEMORY_HEADING = '## 项目记忆（';

export const MEMORY_RECALL_HEADING = '## 相关记忆（';

const PICKED_PROJECT_LINE_RE = /^【输入框选定项目：[^\n]*）】\n/;

export function stripTurnContext(text: string): string {
  const body = text.replace(PICKED_PROJECT_LINE_RE, '');
  const cuts = [PROJECT_INSTRUCTIONS_HEADING, PROJECT_MEMORY_HEADING, MEMORY_RECALL_HEADING]
    .map((heading) => body.indexOf(`\n\n${heading}`))
    .filter((at) => at !== -1);
  return cuts.length === 0 ? body : body.slice(0, Math.min(...cuts));
}
