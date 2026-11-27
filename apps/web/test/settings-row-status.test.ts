import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
const ROW_TAGS = ['SettingsRow', 'RuleRow', 'SettingsSection', 'SettingsDangerZone'];
const HELPER_ATTRS = ['hint', 'description', 'hintClassName'];

const STATUS_LINES: Record<string, string[]> = {
  'design/patterns.tsx': ['1 status lines'],
  'pages/project-settings-page.tsx': ['1 status lines'],
  'resources/backup-settings-section.tsx': [
    '2 status lines',
    '导出所有对话、任务、附件和配置到本地文件（不含密钥文件）',
    '收起原因',
    '查看原因',
  ],
  'resources/routing-settings-page.tsx': [
    '2 status lines',
    'Coordinator',
    'Coordinator 要有模型才能回答你的消息',
    '先给 Coordinator 选模型',
  ],
  'routes/account-page.tsx': ['1 status lines', '浏览器已拒绝通知权限，需到站点设置重新允许'],
  'routes/remote-access-page.tsx': [
    '1 status lines',
    '正在启动远程访问…',
    '这个安装没有附带远程访问组件',
    '远程访问启动失败，请关闭后重新打开',
    '远程访问已开启',
    '远程访问状态加载失败，请重试',
    '远程访问需要开启访问认证',
    '需要登录 Tailscale：用下面的链接或二维码登录，成功后自动开启',
  ],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : [];
  });
}

function openingTag(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

function attribute(tag: string, name: string): string | null {
  const at = new RegExp(`\\s${name}=`).exec(tag);
  if (at === null) return null;
  const from = at.index + at[0].length;
  if (tag[from] !== '{') return tag.slice(from, tag.indexOf(tag[from] ?? '"', from + 1) + 1);
  return balanced(tag, from);
}

function balanced(text: string, from: number): string {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(from, i + 1);
  }
  return text.slice(from);
}

function statusSource(text: string, value: string): string {
  const name = /^\{\s*([A-Za-z_$][\w$]*)\b/.exec(value)?.[1];
  if (name === undefined) return value;
  const declared = new RegExp(`\\n(\\s*)const ${name}\\b`).exec(text);
  if (declared === null) return value;
  const indent = declared[1] ?? '';
  const from = declared.index + 1;
  const next = new RegExp(`\\n${indent}(?:const|let|return|function|if)\\b`, 'g');
  next.lastIndex = from + indent.length + 1;
  const end = next.exec(text)?.index ?? text.length;
  return value + text.slice(from, end);
}

function scan() {
  const helpers: string[] = [];
  const status: Record<string, string[]> = {};
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(SRC, file);
    for (const tagName of ROW_TAGS) {
      const opener = new RegExp(`<${tagName}[\\s>]`, 'g');
      for (const match of text.matchAll(opener)) {
        const tag = openingTag(text, match.index);
        for (const name of HELPER_ATTRS) {
          if (attribute(tag, name) !== null) helpers.push(`${rel}: <${tagName} ${name}=…>`);
        }
        const value = attribute(tag, 'status');
        if (value === null) continue;
        if (value === '{status}' && rel === 'resources/routing-settings-page.tsx' && tagName === 'SettingsRow') continue;
        const keys = [...statusSource(text, value).matchAll(/t\(\s*'([^']+)'/g)].map((m) => m[1] ?? '');
        const list = status[rel] ?? [];
        list.push('(status line)', ...keys);
        status[rel] = list;
      }
    }
  }
  for (const [rel, list] of Object.entries(status)) {
    const lines = list.filter((key) => key === '(status line)').length;
    status[rel] = [`${lines} status lines`, ...new Set(list.filter((key) => key !== '(status line)'))].sort();
  }
  return { helpers, status };
}

test('C47: a settings row carries no helper or description line', () => {
  expect(scan().helpers, 'C47: helper lines under settings rows are not allowed').toEqual([]);
});

test('C47: every status line under a settings row is a known state line', () => {
  const pinned = Object.fromEntries(
    Object.entries(STATUS_LINES).map(([file, keys]) => [file, [...keys].sort()]),
  );
  expect(
    scan().status,
    'C47: a new status= on a settings row must report state, never explain; pin it here only if it does',
  ).toEqual(pinned);
});
