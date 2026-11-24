import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import * as ts from 'typescript/unstable/ast';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API } from 'typescript/unstable/sync';

const serverRequire = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const sharedRequire = createRequire(new URL('../../packages/shared/package.json', import.meta.url));
const drizzle = 'node_modules/drizzle-orm/';
const betterSqlite = 'node_modules/@types/better-sqlite3/';
const nodeSqlite = 'node_modules/@types/node/sqlite.d.ts';
const typeRoots = new Map([
  [drizzle, dirname(serverRequire.resolve('drizzle-orm'))],
  [betterSqlite, dirname(serverRequire.resolve('@types/better-sqlite3/package.json'))],
  [nodeSqlite, sharedRequire.resolve('@types/node/sqlite.d.ts')],
]);
const declarations = new Map();

export function databaseTypeFile(path) {
  const root = [...typeRoots.keys()].find((prefix) => path.startsWith(prefix));
  if (root === undefined) return undefined;
  if (!declarations.has(path)) {
    try {
      declarations.set(
        path,
        readFileSync(
          root === nodeSqlite
            ? typeRoots.get(root)
            : `${typeRoots.get(root)}/${path.slice(root.length)}`,
          'utf8',
        ),
      );
    } catch (error) {
      if (!['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) throw error;
      declarations.set(path, null);
    }
  }
  return declarations.get(path);
}

const surfaces = new Map([
  [`${drizzle}sqlite-core/db.d.ts`, ['BaseSQLiteDatabase', 'SQLiteTransaction']],
  [`${drizzle}sqlite-core/session.d.ts`, ['SQLitePreparedQuery', 'ExecuteResultSync']],
  [`${drizzle}sqlite-core/query-builders/select.d.ts`, ['SQLiteSelectBase']],
  [`${drizzle}sqlite-core/query-builders/insert.d.ts`, ['SQLiteInsertBase', 'SQLiteInsertBuilder']],
  [`${drizzle}sqlite-core/query-builders/update.d.ts`, ['SQLiteUpdateBase', 'SQLiteUpdateBuilder']],
  [`${drizzle}sqlite-core/query-builders/delete.d.ts`, ['SQLiteDeleteBase']],
  [
    `${drizzle}sqlite-core/query-builders/query.d.ts`,
    ['RelationalQueryBuilder', 'SQLiteRelationalQuery', 'SQLiteSyncRelationalQuery'],
  ],
  [`${drizzle}query-promise.d.ts`, ['QueryPromise']],
  [`${betterSqlite}index.d.ts`, ['Database', 'Statement', 'Transaction']],
  [nodeSqlite, ['DatabaseSync', 'StatementSync', 'SQLTagStore']],
]);

let driverSurfaces;
export function databaseMethodSurfaces() {
  if (driverSurfaces) return driverSurfaces;
  const cwd = '/cairn-db-declarations';
  const config = `${cwd}/tsconfig.json`;
  const paths = [...surfaces.keys()];
  const files = Object.fromEntries(
    paths.map((path) => {
      const source = databaseTypeFile(path);
      if (source == null) throw new Error(`Missing installed database declaration: ${path}`);
      return [`${cwd}/${path}`, source];
    }),
  );
  files[config] = JSON.stringify({ compilerOptions: { noLib: true, types: [] }, files: paths });
  const api = new API({ cwd, fs: createVirtualFileSystem(files) });
  try {
    using snapshot = api.updateSnapshot({ openProjects: [config] });
    const { program } = snapshot.getProject(config);
    driverSurfaces = paths.flatMap((path) => {
      const names = surfaces.get(path);
      const methods = new Map(names.map((name) => [name, { calls: new Set(), typeArguments: 0 }]));
      const visit = (node) => {
        if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
          const found = methods.get(node.name?.text);
          if (found) found.typeArguments = node.typeParameters?.length ?? 0;
          if (found)
            for (const member of node.members) {
              if (
                member.modifiers?.some(({ kind }) =>
                  [
                    ts.SyntaxKind.PrivateKeyword,
                    ts.SyntaxKind.ProtectedKeyword,
                    ts.SyntaxKind.StaticKeyword,
                  ].includes(kind),
                )
              )
                continue;
              if (
                ts.isMethodSignatureDeclaration(member) ||
                ts.isMethodDeclaration(member) ||
                ((ts.isPropertyDeclaration(member) || ts.isPropertySignatureDeclaration(member)) &&
                  member.type &&
                  (ts.isFunctionTypeNode(member.type) || ts.isIndexedAccessTypeNode(member.type)))
              ) {
                if (ts.isIdentifier(member.name)) found.calls.add(member.name.text);
              }
            }
        }
        node.forEachChild(visit);
      };
      visit(program.getSourceFile(`${cwd}/${path}`));
      return [...methods].map(([surface, { calls, typeArguments }]) => ({
        path,
        surface,
        typeArguments,
        methods: [...calls].sort(),
      }));
    });
    return driverSurfaces;
  } finally {
    api.close();
  }
}

export function isDatabaseDeclaration(path) {
  return (
    path === nodeSqlite ||
    path.startsWith(betterSqlite) ||
    path.startsWith(`${drizzle}sqlite-core/`) ||
    path.startsWith(`${drizzle}better-sqlite3/`) ||
    path === `${drizzle}query-promise.d.ts`
  );
}

function sqlTokens(source) {
  return (
    source.match(
      /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[:@$][\w$\u0080-\uFFFF]+(?:::[\w$\u0080-\uFFFF]+)*(?:\([^)]*\))?|\?\d*|[\w$\u0080-\uFFFF]+|[^\s]/g,
    ) ?? []
  ).filter((token) => !token.startsWith('--') && !token.startsWith('/*'));
}

function sqlName(token) {
  if (token?.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
  if (token?.startsWith('"')) return token.slice(1, -1).replaceAll('""', '"');
  if (token?.startsWith('`')) return token.slice(1, -1).replaceAll('``', '`');
  if (token?.startsWith('[')) return token.slice(1, -1);
  return token;
}

function tableRenames(tokens) {
  const word = (index) => tokens[index]?.toUpperCase();
  const renames = new Map();
  for (let start = 0; start < tokens.length; start += 1) {
    if (word(start) !== 'ALTER' || word(start + 1) !== 'TABLE') continue;
    const nameIndex = tokens[start + 3] === '.' ? start + 4 : start + 2;
    if (word(nameIndex + 1) !== 'RENAME' || word(nameIndex + 2) !== 'TO') continue;
    const from = sqlName(tokens[nameIndex])?.toLowerCase();
    const to = sqlName(tokens[nameIndex + 3])?.toLowerCase();
    if (!from || !to) continue;
    if (!renames.has(from)) renames.set(from, new Set());
    renames.get(from).add(to);
  }
  return renames;
}

function includeRenamedTables(tables, renames) {
  for (const name of tables) {
    for (const alias of renames.get(name) ?? []) tables.add(alias);
  }
  return tables;
}

function replacementTargets(tokens, renames) {
  const word = (index) => tokens[index]?.toUpperCase();
  const tables = new Set();
  for (let start = 0; start < tokens.length; start += 1) {
    if (word(start) !== 'CREATE') continue;
    let cursor = start + 1;
    if (['TEMP', 'TEMPORARY'].includes(word(cursor))) cursor += 1;
    if (word(cursor++) !== 'TABLE') continue;
    if (word(cursor) === 'IF' && word(cursor + 1) === 'NOT' && word(cursor + 2) === 'EXISTS')
      cursor += 3;
    if (tokens[cursor + 1] === '.') cursor += 2;
    const table = sqlName(tokens[cursor++]);
    if (tokens[cursor] !== '(') continue;
    let depth = 0;
    for (; cursor < tokens.length && tokens[cursor] !== ';'; cursor += 1) {
      if (tokens[cursor] === '(') depth += 1;
      if (tokens[cursor] === ')') depth -= 1;
      if (depth === 0) break;
      if (
        depth === 1 &&
        word(cursor) === 'ON' &&
        word(cursor + 1) === 'CONFLICT' &&
        word(cursor + 2) === 'REPLACE'
      ) {
        tables.add(table.toLowerCase());
        break;
      }
    }
  }
  return includeRenamedTables(tables, renames);
}

export function sqliteReplacementTables(source) {
  const tokens = sqlTokens(source);
  return replacementTargets(tokens, tableRenames(tokens));
}

export function sqliteWrites(source, replacementTables = new Set()) {
  const tokens = sqlTokens(source);
  const renames = tableRenames(tokens);
  const localReplacementTables = replacementTargets(tokens, renames);
  const word = (index) => tokens[index]?.toUpperCase();
  const name = (index) => sqlName(tokens[index]);
  const writes = [];
  const identifier = (index) =>
    /^(?:[a-zA-Z_$][\w$]*|\?|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|'(?:''|[^'])*')$/.test(
      tokens[index] ?? '',
    );
  const targetColumns = (start, end, columns) => {
    let cursor = start + 1;
    while (cursor < end) {
      if (!identifier(cursor)) return undefined;
      columns.add(name(cursor++));
      if (tokens[cursor] === ')') return cursor + 1;
      if (tokens[cursor++] !== ',') return undefined;
    }
    return undefined;
  };
  const assignments = (start, end, columns) => {
    let cursor = start;
    while (cursor < end) {
      if (tokens[cursor] === '(') cursor = targetColumns(cursor, end, columns);
      else if (identifier(cursor)) columns.add(name(cursor++));
      else return false;
      if (cursor === undefined || tokens[cursor++] !== '=') return false;
      const value = cursor;
      let depth = 0;
      for (; cursor < end; cursor += 1) {
        if (
          depth === 0 &&
          ([',', ')', ';'].includes(tokens[cursor]) ||
            ['WHERE', 'RETURNING', 'ORDER', 'LIMIT'].includes(word(cursor)) ||
            (word(cursor) === 'FROM' && word(cursor - 1) !== 'DISTINCT') ||
            (word(cursor) === 'ON' && word(cursor + 1) === 'CONFLICT'))
        )
          break;
        if (tokens[cursor] === '(') depth += 1;
        if (tokens[cursor] === ')') depth -= 1;
      }
      if (depth !== 0 || cursor === value) return false;
      if (tokens[cursor] !== ',') return true;
      cursor += 1;
    }
    return false;
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const verb = word(index);
    let cursor = index + 1;
    if (verb === 'ALTER' && word(cursor) === 'TABLE') {
      cursor += 1;
      if (tokens[cursor + 1] === '.') cursor += 2;
      const table = identifier(cursor) ? name(cursor++) : '?';
      if (word(cursor++) !== 'ADD') continue;
      if (word(cursor) === 'COLUMN') cursor += 1;
      const column = identifier(cursor) ? name(cursor) : undefined;
      const end = tokens.indexOf(';', cursor);
      const boundary = end < 0 ? tokens.length : end;
      writes.push({
        table,
        tableNames: includeRenamedTables(new Set([table.toLowerCase()]), renames),
        columns: new Set(column ? [column] : []),
        symbol: tokens.slice(index, cursor + 1).join(' '),
        statement: tokens.slice(index, boundary).join(' '),
        resolved: table !== '?' && column !== undefined,
        replacesRow: false,
      });
      continue;
    }
    if (!['INSERT', 'REPLACE', 'UPDATE', 'UPSERT', 'DELETE'].includes(verb)) continue;
    if (verb === 'REPLACE' && (tokens[cursor] === '(' || word(index - 1) === 'CONFLICT')) continue;
    if (['AFTER', 'BEFORE', 'OF', 'ON', 'OR'].includes(word(index - 1))) continue;
    if (verb === 'UPDATE' && word(index - 1) === 'DO') continue;
    let resolved = verb !== 'UPSERT';
    const conflict = word(cursor) === 'OR' ? word(cursor + 1) : undefined;
    if (conflict !== undefined) cursor += 2;
    if (['INSERT', 'REPLACE'].includes(verb)) {
      if (word(cursor) === 'INTO') cursor += 1;
      else resolved = false;
    }
    if (verb === 'DELETE') {
      if (word(cursor) === 'FROM') cursor += 1;
      else resolved = false;
    }
    if (tokens[cursor + 1] === '.') cursor += 2;
    const tableIndex = cursor;
    const table = identifier(tableIndex) ? name(cursor++) : '?';
    const tableNames = includeRenamedTables(new Set([table.toLowerCase()]), renames);
    resolved &&= table !== '?';
    if (word(cursor) === 'AS') {
      resolved &&= identifier(cursor + 1);
      cursor += 2;
    }
    if (['UPDATE', 'DELETE'].includes(verb)) {
      if (word(cursor) === 'NOT' && word(cursor + 1) === 'INDEXED') cursor += 2;
      else if (word(cursor) === 'INDEXED' && word(cursor + 1) === 'BY') {
        resolved &&= identifier(cursor + 2);
        cursor += 3;
      }
    }
    const start = tokens.lastIndexOf(';', index) + 1;
    const end = tokens.indexOf(';', cursor);
    const boundary = end < 0 ? tokens.length : end;
    const statement = tokens.slice(start, boundary).join(' ');
    const symbol = tokens.slice(index, tableIndex + 1).join(' ');
    const columns = new Set();
    if (verb === 'UPDATE') {
      resolved &&= word(cursor++) === 'SET' && assignments(cursor, boundary, columns);
    } else if (verb === 'DELETE') {
      resolved &&=
        cursor === boundary || ['WHERE', 'RETURNING', 'ORDER', 'LIMIT'].includes(word(cursor));
    } else {
      if (tokens[cursor] === '(') {
        cursor = targetColumns(cursor, boundary, columns);
        resolved &&= cursor !== undefined;
      }
      resolved &&=
        ['VALUES', 'SELECT', 'WITH'].includes(word(cursor)) ||
        (word(cursor) === 'DEFAULT' && word(cursor + 1) === 'VALUES');
    }
    const replacesRow =
      verb === 'REPLACE' ||
      conflict === 'REPLACE' ||
      (conflict === undefined &&
        ['INSERT', 'UPDATE'].includes(verb) &&
        (localReplacementTables.has(table.toLowerCase()) ||
          replacementTables.has(table.toLowerCase())));
    writes.push({ table, tableNames, columns, symbol, statement, resolved, replacesRow });
    if (!['INSERT', 'REPLACE'].includes(verb) || cursor === undefined) continue;
    for (; cursor < boundary; cursor += 1) {
      if (word(cursor) === 'DO' && word(cursor + 1) === 'UPDATE') {
        const columns = new Set();
        const resolved = word(cursor + 2) === 'SET' && assignments(cursor + 3, boundary, columns);
        writes.push({
          table,
          tableNames,
          columns,
          symbol: `${symbol} ON CONFLICT DO UPDATE`,
          statement,
          resolved,
        });
      }
    }
  }
  return writes;
}
