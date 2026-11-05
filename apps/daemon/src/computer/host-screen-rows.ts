export const SCREEN_MAX_ROWS = 400;
export const SCREEN_MAX_ROWS_CHARS = 48_000;
const REF = /^@([^:\s]+):e(\d+)$/;

export interface AccessibilityNode {
  ref_id?: string;
  role?: string;
  name?: string;
  value?: string | null;
  states?: string[];
  available_actions?: string[];
  subtree_truncated?: boolean;
  children?: AccessibilityNode[];
}

export interface AccessibilityRows {
  text: string;
  truncated: boolean;
  strings: string[];
}

function rowFor(node: AccessibilityNode, snapshotId: string, depth: number): string | undefined {
  const match = node.ref_id ? REF.exec(node.ref_id) : null;
  const element = match && match[1] === snapshotId ? `[${match[2]}] ` : '';
  if (element === '' && !node.name) return undefined;
  const parts = [
    `${element}${node.role ?? 'element'}`,
    ...(node.name ? [JSON.stringify(node.name)] : []),
    ...(node.value && node.value !== node.name ? [`= ${JSON.stringify(node.value)}`] : []),
    ...(node.states?.length ? [`(${node.states.join(', ')})`] : []),
    ...(node.available_actions?.length ? [`{${node.available_actions.join(', ')}}`] : []),
  ];
  return `${'  '.repeat(depth)}- ${parts.join(' ')}`;
}

export function accessibilityRows(
  roots: readonly AccessibilityNode[],
  snapshotId: string,
  incomplete: boolean,
): AccessibilityRows {
  const lines: string[] = [];
  const strings: string[] = [];
  let length = 0;
  let truncated = incomplete;
  const visit = (node: AccessibilityNode, depth: number): void => {
    if (node.name) strings.push(node.name);
    if (node.value) strings.push(node.value);
    if (node.subtree_truncated) truncated = true;
    const row = rowFor(node, snapshotId, depth);
    if (row !== undefined) {
      if (lines.length >= SCREEN_MAX_ROWS || length + row.length > SCREEN_MAX_ROWS_CHARS) {
        truncated = true;
      } else {
        lines.push(row);
        length += row.length + 1;
      }
    }
    for (const child of node.children ?? []) visit(child, row === undefined ? depth : depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return { text: lines.join('\n'), truncated, strings };
}
