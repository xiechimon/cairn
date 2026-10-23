// GitHub 给的文本进 cairn 自己写的行与文案之前的清洗（#1403）：PR 对账的 system 行
// （ci-loop.ts）与经 GitHub API 合并的合并行、拒绝文案（builds.ts requestMerge）共用。
// 会话行经 chief / MCP 的会话读工具交给 agent，也在 web 时间线上显示；拒绝文案进合并
// 弹层。

/** 一段 GitHub 文本的长度上界（字符数）。 */
const GITHUB_TEXT_MAX = 100;

/** GitHub 给的文本（分支名、合并者、合并提交、拒绝理由）：去掉控制字符与格式字符（git
 * 分支名允许双向覆盖 U+202E、零宽字符这类，显示出来会把文字倒过来或藏起来），超过上界
 * 截断并加省略号。 */
export function githubText(text: string): string {
  const chars = Array.from(text.replace(/[\p{Cc}\p{Cf}]/gu, ''));
  return chars.length > GITHUB_TEXT_MAX
    ? `${chars.slice(0, GITHUB_TEXT_MAX).join('')}…`
    : chars.join('');
}
