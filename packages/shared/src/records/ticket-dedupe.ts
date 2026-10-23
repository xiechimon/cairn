// 票去重键（#1492）：自动开的票（#1407 纠错票、园丁票）开票前按键查重，
// 同一类问题不反复开票。键 = 失误类别 + 涉及路径（排序去重）——含路径是为了
// 不把两个不同问题合成一张（#1492 失败方式）。键以隐藏注释写进 issue body，
// 查重只读这个标记，不按正文文字猜。

/** 开票方给出的去重材料：类别（如 missing-test）+ 涉及的仓内路径。 */
export interface TicketDedupeInput {
  category: string;
  paths: readonly string[];
}

const MARKER_HEAD = '<!-- pacman-dedupe: ';
const MARKER_TAIL = ' -->';

/** 去重键：类别小写去空白 + 路径归一（去 ./ 前缀与尾 /）后排序去重，`|` 连接。 */
export function ticketDedupeKey(input: TicketDedupeInput): string {
  const category = input.category.trim().toLowerCase().replace(/\s+/g, '-');
  if (category === '') throw new Error('ticket dedupe category must not be empty');
  const paths = [
    ...new Set(
      input.paths
        .map((p) => p.trim().replace(/^\.\//, '').replace(/\/+$/, ''))
        .filter((p) => p !== ''),
    ),
  ].sort();
  return [category, ...paths].join('|');
}

/** 写进 issue body 的隐藏标记行（GitHub 渲染时不可见）。 */
export function ticketDedupeMarker(key: string): string {
  return `${MARKER_HEAD}${key}${MARKER_TAIL}`;
}

/** 从 issue body 读回去重键；没有标记 = null。 */
export function parseTicketDedupeKey(body: string | null | undefined): string | null {
  if (body == null) return null;
  const at = body.indexOf(MARKER_HEAD);
  if (at < 0) return null;
  const end = body.indexOf(MARKER_TAIL, at + MARKER_HEAD.length);
  if (end < 0) return null;
  return body.slice(at + MARKER_HEAD.length, end);
}

/** 开票前查重：open 票里带同键标记的第一张；已关闭的不算（问题复发要重新开）。 */
export function findDuplicateTicket<T extends { state: string; body?: string | null }>(
  key: string,
  issues: readonly T[],
): T | null {
  return (
    issues.find((i) => i.state.toLowerCase() === 'open' && parseTicketDedupeKey(i.body) === key) ??
    null
  );
}
