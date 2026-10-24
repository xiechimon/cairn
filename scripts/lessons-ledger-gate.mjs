#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FIELDS = ['类别', '首次来源', '级别', '防护', '拦截', '复发', '备注'];
const ENTRY_NAME = /^\d+-[a-z0-9]+(-[a-z0-9]+)*\.md$/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---(\n|$)/;

export function parseEntry(text) {
  const match = FRONTMATTER.exec(text);
  if (!match) return { fields: null, problems: ['缺少开头的 --- frontmatter'] };
  const lines = match[1].split('\n');
  const problems = [];
  const fields = {};
  for (const line of lines) {
    const separator = line.indexOf(':');
    const key = separator === -1 ? line : line.slice(0, separator);
    if (!FIELDS.includes(key)) problems.push(`未知或格式错误的行: ${line.slice(0, 30)}`);
    else if (Object.hasOwn(fields, key)) problems.push(`字段重复: ${key}`);
    else fields[key] = line.slice(separator + 1).trim();
  }
  const present = lines.map((line) => line.slice(0, line.indexOf(':'))).filter((k) => k in fields);
  for (const key of FIELDS) if (!(key in fields)) problems.push(`缺字段: ${key}`);
  if (problems.length === 0 && present.join() !== FIELDS.join())
    problems.push(`字段顺序必须是 ${FIELDS.join('、')}`);
  return { fields: problems.length === 0 ? fields : null, problems };
}

export function checkEntry(fileName, text) {
  const violations = [];
  if (!ENTRY_NAME.test(fileName))
    violations.push(`${fileName}: 文件名必须是 <票号>-<短名>.md，短名为小写字母数字连字符`);
  const { fields, problems } = parseEntry(text);
  violations.push(...problems.map((problem) => `${fileName}: ${problem}`));
  if (fields === null) return violations;
  for (const key of ['类别', '首次来源', '防护'])
    if (fields[key] === '') violations.push(`${fileName}: ${key}不能为空`);
  if (!/^[1-5]$/.test(fields.级别)) violations.push(`${fileName}: 级别必须是 1 到 5`);
  for (const key of ['拦截', '复发'])
    if (!/^\d+$/.test(fields[key])) violations.push(`${fileName}: ${key}必须是非负整数`);
  if (Number(fields.级别) >= 4 && fields.备注 === '')
    violations.push(`${fileName}: 级别 ${fields.级别} 必须在备注写明为什么做不成更高级`);
  if (fields.备注.includes('待升') && !/#\d+/.test(fields.备注))
    violations.push(`${fileName}: 「待升」必须带票号`);
  return violations;
}

export function ledgerEntries(root) {
  const directory = join(root, 'docs/lessons');
  return readdirSync(directory)
    .filter((name) => name !== 'README.md')
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => ({ name, text: readFileSync(join(directory, name), 'utf8') }));
}

export function checkLedgerRoot(root) {
  const violations = [];
  if (existsSync(join(root, 'docs/lessons.md')))
    violations.push('docs/lessons.md 已拆成 docs/lessons/ 单文件，不许再建汇总表文件');
  if (!existsSync(join(root, 'docs/lessons'))) return [...violations, 'docs/lessons/ 目录缺失'];
  const entries = ledgerEntries(root);
  if (entries.length === 0) violations.push('docs/lessons/ 里没有任何条目');
  for (const { name, text } of entries) violations.push(...checkEntry(name, text));
  return violations;
}

export function renderTable(entries) {
  const rows = entries.map(({ name, text }) => {
    const { fields } = parseEntry(text);
    return `| ${[name.replace(/\.md$/, ''), ...FIELDS.map((key) => fields[key])].map((value) => value.replaceAll('|', '\\|')).join(' | ')} |`;
  });
  return [`| 文件 | ${FIELDS.join(' | ')} |`, `|${'---|'.repeat(FIELDS.length + 1)}`, ...rows].join(
    '\n',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL('..', import.meta.url).pathname;
  if (process.argv[2] === '--table') {
    console.log(renderTable(ledgerEntries(root)));
    process.exit(0);
  }
  const violations = checkLedgerRoot(root);
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exit(1);
  }
  console.log('lessons ledger ok');
}
