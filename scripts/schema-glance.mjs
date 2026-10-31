import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const META_DIR = 'apps/server/drizzle/meta';
const SNAPSHOT_NAME = /^(\d+)_snapshot\.json$/;
const HEADING = '### Schema changes';

const byName = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sortedKeys = (record) => Object.keys(record ?? {}).sort(byName);
const escapeCell = (text) => String(text).replaceAll('|', '\\|');
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function describeColumn(column) {
  const parts = [column.type];
  if (column.notNull) parts.push('NOT NULL');
  if (column.default !== undefined) parts.push(`default ${column.default}`);
  return parts.join(' ');
}

function describeColumnChange(before, after) {
  const parts = [];
  if (before.type !== after.type) parts.push(`type ${before.type} -> ${after.type}`);
  if (Boolean(before.notNull) !== Boolean(after.notNull))
    parts.push(after.notNull ? 'NOT NULL added' : 'NOT NULL dropped');
  if (before.default !== after.default)
    parts.push(`default ${before.default ?? 'none'} -> ${after.default ?? 'none'}`);
  if (Boolean(before.primaryKey) !== Boolean(after.primaryKey))
    parts.push(after.primaryKey ? 'primary key added' : 'primary key dropped');
  if (JSON.stringify(before.generated) !== JSON.stringify(after.generated))
    parts.push('generated expression changed');
  return parts.join('; ');
}

function describeIndex(index) {
  const columns = Array.isArray(index.columns) ? `(${index.columns.join(', ')})` : '';
  return [index.isUnique ? 'unique' : '', columns, index.where ? `where ${index.where}` : '']
    .filter(Boolean)
    .join(' ');
}

function describeForeignKey(key) {
  const customActions = [key.onDelete, key.onUpdate].some(
    (action) => action && action !== 'no action',
  );
  const actions = customActions
    ? ` on delete ${key.onDelete ?? 'no action'} on update ${key.onUpdate ?? 'no action'}`
    : '';
  return `(${(key.columnsFrom ?? []).join(', ')}) -> ${key.tableTo}(${(key.columnsTo ?? []).join(', ')})${actions}`;
}

function diffColumns(rows, tableName, before, after) {
  for (const key of sortedKeys(after)) {
    if (!(key in before)) {
      rows.push([tableName, `+ ${key}`, describeColumn(after[key])]);
      continue;
    }
    const change = describeColumnChange(before[key], after[key]);
    if (change) rows.push([tableName, `~ ${key}`, change]);
  }
  for (const key of sortedKeys(before)) {
    if (!(key in after)) rows.push([tableName, `- ${key}`, describeColumn(before[key])]);
  }
}

function diffEntries(rows, tableName, label, before, after, describe) {
  const previous = before ?? {};
  const next = after ?? {};
  for (const key of sortedKeys(next)) {
    if (!(key in previous)) rows.push([tableName, `+ ${label} ${key}`, describe(next[key])]);
    else if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      rows.push([
        tableName,
        `~ ${label} ${key}`,
        `${describe(previous[key])} -> ${describe(next[key])}`,
      ]);
    }
  }
  for (const key of sortedKeys(previous)) {
    if (!(key in next)) rows.push([tableName, `- ${label} ${key}`, describe(previous[key])]);
  }
}

function collectRows(oldSnapshot, newSnapshot) {
  const before = oldSnapshot.tables ?? {};
  const after = newSnapshot.tables ?? {};
  const rows = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(byName)) {
    const name = (after[key] ?? before[key]).name ?? key;
    if (!(key in before)) {
      rows.push([
        name,
        'table added',
        plural(Object.keys(after[key].columns ?? {}).length, 'column'),
      ]);
    } else if (!(key in after)) {
      rows.push([
        name,
        'table dropped',
        plural(Object.keys(before[key].columns ?? {}).length, 'column'),
      ]);
    } else {
      diffColumns(rows, name, before[key].columns ?? {}, after[key].columns ?? {});
      diffEntries(rows, name, 'index', before[key].indexes, after[key].indexes, describeIndex);
      diffEntries(
        rows,
        name,
        'foreign key',
        before[key].foreignKeys,
        after[key].foreignKeys,
        describeForeignKey,
      );
    }
  }
  return rows;
}

export function renderSchemaGlance(oldSnapshot, newSnapshot) {
  const rows = collectRows(oldSnapshot, newSnapshot);
  if (rows.length === 0) return `${HEADING}\n\nNo schema changes\n`;
  const lines = rows.map(
    ([table, change, detail]) => `| \`${table}\` | ${escapeCell(change)} | ${escapeCell(detail)} |`,
  );
  return `${HEADING}\n\n| table | change | detail |\n|---|---|---|\n${lines.join('\n')}\n`;
}

export function newestSnapshotName(names) {
  const numbered = names
    .map((name) => ({ name, match: SNAPSHOT_NAME.exec(name) }))
    .filter((entry) => entry.match)
    .sort((left, right) => Number(right.match[1]) - Number(left.match[1]));
  return numbered[0]?.name ?? null;
}

function readSnapshotAtRef(ref) {
  const listing = execFileSync('git', ['ls-tree', '--name-only', ref, `${META_DIR}/`], {
    encoding: 'utf8',
  });
  const name = newestSnapshotName(
    listing.split('\n').map((path) => path.slice(path.lastIndexOf('/') + 1)),
  );
  if (!name) throw new Error(`no drizzle snapshot found at ${ref}`);
  const raw = execFileSync('git', ['show', `${ref}:${META_DIR}/${name}`], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

function optionValue(args, flag) {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

export function main(args) {
  const base = optionValue(args, '--base');
  const head = optionValue(args, '--head');
  if (base && head) return renderSchemaGlance(readSnapshotAtRef(base), readSnapshotAtRef(head));
  const [oldPath, newPath] = args;
  if (!oldPath || !newPath || oldPath.startsWith('--')) {
    throw new Error('usage: schema-glance.mjs <old.json> <new.json> | --base <ref> --head <ref>');
  }
  return renderSchemaGlance(
    JSON.parse(readFileSync(oldPath, 'utf8')),
    JSON.parse(readFileSync(newPath, 'utf8')),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
