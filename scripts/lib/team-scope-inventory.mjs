import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as ts from 'typescript/unstable/ast';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API, SignatureKind, SymbolFlags } from 'typescript/unstable/sync';
import * as drizzleSchema from '../../apps/server/src/db/schema.ts';
import {
  databaseMethodSurfaces,
  databaseTypeFile,
  isDatabaseDeclaration,
  sqliteReplacementTables,
  sqliteWrites,
} from './team-scope-sql.mjs';

const JS = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const FIXTURE =
  /(?:^|\/)(?:test|tests|e2e|__tests__|__fixtures__|fixtures)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const PRODUCT_ROOTS = ['apps/server/src', 'apps/daemon/src'];
const MIGRATION_ROOT = 'apps/server/drizzle';
const IDENTIFIER = /^(?:[A-Za-z_$][\w$]*)$/;

export const inventoryPath = 'apps/server/test/fixtures/team-scope/manifest.json';
export const allowlistPath = 'apps/server/test/fixtures/team-scope/legacy-allowlist.json';
export const digest = (source) => createHash('sha256').update(source).digest('hex');

function trackedPaths(root, paths) {
  return [
    ...new Set(
      execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...paths],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
          maxBuffer: 8 * 1024 * 1024,
        },
      )
        .split('\0')
        .filter(Boolean),
    ),
  ];
}

export function isProtectedSource(path) {
  return (
    PRODUCT_ROOTS.some((prefix) => path.startsWith(`${prefix}/`)) &&
    JS.test(path) &&
    !FIXTURE.test(path)
  );
}

export function migrationFindings(root) {
  const read = sourceReader(root);
  return trackedPaths(root, [MIGRATION_ROOT])
    .filter((path) => path.endsWith('.sql'))
    .flatMap((path) => accessFindings(path, read(path)));
}

export function sourceReader(root) {
  return (path) => {
    if (!path || isAbsolute(path) || path.split('/').some((part) => part === '..')) {
      throw new Error(`Not a repository path: ${path}`);
    }
    let current = root;
    for (const part of path.split('/')) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Unresolved source link: ${path}`);
    }
    return readFileSync(current, 'utf8').replaceAll('\r\n', '\n');
  };
}

export function schemaTables(source) {
  return [...source.matchAll(/^export const (\w+) = sqliteTable\(\s*['"]([^'"]+)['"]/gm)].map(
    ([, symbol, table]) => ({ table, symbol }),
  );
}

export function sqlTriggers(source) {
  const sqlToken =
    /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[\w$]+|[^\s]/g;
  const tokens = [...source.matchAll(sqlToken)].filter(
    ([token]) => !token.startsWith('--') && !token.startsWith('/*'),
  );
  const word = (index) => tokens[index]?.[0].toUpperCase();
  const found = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (word(i) !== 'CREATE') continue;
    let cursor = i + 1;
    if (word(cursor) === 'TEMP' || word(cursor) === 'TEMPORARY') cursor += 1;
    if (word(cursor) !== 'TRIGGER') continue;
    cursor += 1;
    if (word(cursor) === 'IF' && word(cursor + 1) === 'NOT' && word(cursor + 2) === 'EXISTS') {
      cursor += 3;
    }
    const name = tokens[cursor]?.[0].replace(/^[`"'[]|[`"'\]]$/g, '') ?? '<missing>';
    let body = false;
    let cases = 0;
    for (; cursor < tokens.length; cursor += 1) {
      if (word(cursor) === 'BEGIN') body = true;
      if (!body) continue;
      if (word(cursor) === 'CASE') cases += 1;
      if (word(cursor) !== 'END') continue;
      if (cases > 0) cases -= 1;
      else if (word(cursor + 1) === ';') break;
    }
    if (cursor === tokens.length) throw new Error(`Incomplete trigger definition: ${name}`);
    const end = tokens[cursor + 1].index + 1;
    found.push({ name, definition: source.slice(tokens[i].index, end) });
    i = cursor + 1;
  }
  return found;
}

const sqliteDrivers = new Map([
  ['better-sqlite3', [undefined, 'default']],
  ['node:sqlite', ['DatabaseSync']],
  ['bun:sqlite', ['Database']],
  ['sqlite3', ['Database']],
]);
const schemaPath = 'apps/server/src/db/schema.ts';
const schemaSource = readFileSync(new URL(`../../${schemaPath}`, import.meta.url), 'utf8');
const fileModule = /^(?:node:)?fs(?:\/promises)?$|^(?:fs-extra|graceful-fs)$/;
const networkMethods = new Map([
  ['http', new Set(['request', 'get', 'createServer'])],
  ['https', new Set(['request', 'get', 'createServer'])],
  ['http2', new Set(['connect', 'createServer', 'createSecureServer'])],
  ['net', new Set(['connect', 'createConnection', 'createServer', 'Socket'])],
  ['tls', new Set(['connect', 'createServer', 'TLSSocket'])],
  ['dns', new Set(['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse', 'Resolver'])],
  ['dns/promises', new Set(['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse', 'Resolver'])],
  ['dgram', new Set(['createSocket'])],
  [
    'undici',
    new Set([
      'fetch',
      'request',
      'stream',
      'pipeline',
      'connect',
      'upgrade',
      'WebSocket',
      'Agent',
      'ProxyAgent',
      'EnvHttpProxyAgent',
      'setGlobalDispatcher',
    ]),
  ],
  ['ws', new Set(['WebSocket', 'WebSocketServer', 'createWebSocketStream', 'default'])],
  ['global', new Set(['fetch', 'WebSocket'])],
]);
const streamHelpers = new Map([
  ['stream', new Set(['pipeline', 'compose'])],
  ['stream/promises', new Set(['pipeline'])],
]);
const networkModule = (specifier) => networkMethods.has(specifier.replace(/^node:/, ''));
const networkMember =
  /^(?:fetch|request|write|send|end|connect|listen|lookup|resolve|upgrade|handleUpgrade)$/;
const streamMembers = new Set(['pipe', 'pipeTo', 'pipeThrough']);
const networkFetchType =
  /^(?:typeof (?:globalThis\.)?fetch|FetchLike|SkillImportFetch|ProbeFetch)$/;
const credentialModules = ['secret-box', 'keys', 'token-auth'].map(
  (name) => `apps/server/src/lib/${name}.ts`,
);
const sharedSecretBoxPath = 'packages/shared/src/secret-box.ts';
const credentialSources = new Map(
  [...credentialModules, sharedSecretBoxPath].map((path) => [
    path,
    readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'),
  ]),
);
const credentialModule = /(?:^|\/)(?:secret-box|keys|token-auth)(?:\.[cm]?[jt]s)?$/;
const serviceRoot = 'apps/server/src/services';
const deliverySurfaces = new Map([
  ['apps/server/src/lib/github.ts', new Map([['FetchLike', 'http-fetch']])],
  [`${serviceRoot}/skill-import.ts`, new Map([['SkillImportFetch', 'http-fetch']])],
  ['apps/daemon/src/github-probe.ts', new Map([['ProbeFetch', 'http-fetch']])],
  [`${serviceRoot}/apns.ts`, new Map([['sendApns', 'apns']])],
  [`${serviceRoot}/push.ts`, new Map([['sendPushToUser', 'push']])],
  [
    `${serviceRoot}/mail-smtp.ts`,
    new Map([
      ['sendSmtpMail', 'smtp'],
      ['SendMail', 'smtp'],
    ]),
  ],
  [`${serviceRoot}/push-alerts.ts`, new Map([['send', 'smtp']])],
  [`${serviceRoot}/im/types.ts`, new Map([['send', 'im']])],
  [`${serviceRoot}/im/core.ts`, new Map([['send', 'im']])],
  [`${serviceRoot}/im/imessage.ts`, new Map([['send', 'im']])],
  [`${serviceRoot}/im/slack.ts`, new Map([['slackApi', 'im']])],
  [`${serviceRoot}/im/telegram.ts`, new Map([['telegramApi', 'im']])],
  [
    `${serviceRoot}/im/wechat.ts`,
    new Map([
      ['request', 'im'],
      ['call', 'im'],
    ]),
  ],
  ['apps/daemon/src/imsg-bridge.ts', new Map([['call', 'im-rpc']])],
]);
const deliverySources = new Map(
  ['apns.ts', 'push.ts', 'mail-smtp.ts', 'im/types.ts'].map((name) => {
    const path = `${serviceRoot}/${name}`;
    return [path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')];
  }),
);
const serverRequire = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const deliveryPackages = ['web-push', 'nodemailer', 'ws'];
const deliveryTypeRoots = new Map(
  deliveryPackages.map((name) => [
    `node_modules/@types/${name}/`,
    dirname(serverRequire.resolve(`@types/${name}/package.json`)),
  ]),
);
const nodeTypes = 'node_modules/@types/node/';
const { getTableName, is } = serverRequire('drizzle-orm');
const { getTableConfig, SQLiteTable } = serverRequire('drizzle-orm/sqlite-core');
export function schemaMultiParentForeignKeys(schema = drizzleSchema) {
  const rows = Object.values(schema).flatMap((table) => {
    if (!is(table, SQLiteTable)) return [];
    const { name, foreignKeys } = getTableConfig(table);
    if (foreignKeys.length < 2) return [];
    return [
      [
        name,
        foreignKeys.map(({ reference }) => {
          const { columns, foreignTable, foreignColumns } = reference();
          return [
            columns.map(({ name }) => name),
            getTableName(foreignTable),
            foreignColumns.map(({ name }) => name),
          ];
        }),
      ],
    ];
  });
  return Object.fromEntries(rows.sort(([a], [b]) => a.localeCompare(b)));
}

const expectedForeignKeys = schemaMultiParentForeignKeys();
const sharedRequire = createRequire(new URL('../../packages/shared/package.json', import.meta.url));
const nodeTypeRoot = dirname(sharedRequire.resolve('@types/node/package.json'));
const deliveryDeclarations = new Map();
function deliveryTypeFile(path) {
  const root = [...deliveryTypeRoots.keys()].find((prefix) => path.startsWith(prefix));
  const nodePath =
    path.startsWith(nodeTypes) && /^(?:http2?|https)\.d\.ts$/.test(path.slice(nodeTypes.length));
  if (!root && !nodePath) return undefined;
  if (!deliveryDeclarations.has(path)) {
    const file = root
      ? join(deliveryTypeRoots.get(root), path.slice(root.length))
      : join(nodeTypeRoot, path.slice(nodeTypes.length));
    try {
      deliveryDeclarations.set(path, readFileSync(file, 'utf8'));
    } catch (error) {
      if (!['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) throw error;
      deliveryDeclarations.set(path, null);
    }
  }
  return deliveryDeclarations.get(path);
}

function deliveryBinding({ module, name, resource }) {
  module = module.replace(/^node:/, '');
  if (name === 'fetch' && ['global', 'undici', 'node-fetch', 'cross-fetch'].includes(module))
    return 'http-fetch';
  if (
    ['http', 'https', 'undici'].includes(module) &&
    ['request', 'get', 'stream', 'pipeline'].includes(name)
  )
    return 'http-request';
  if (module === 'web-push' && name === 'sendNotification') return 'web-push';
  if (module === 'http2' && resource === 'network-handle' && name === 'request') return 'http2';
  if (resource === 'curl-stdin' && ['write', 'end'].includes(name)) return 'curl';
  if (
    resource === 'network-handle' &&
    ['global', 'undici', 'ws'].includes(module) &&
    name === 'send'
  )
    return 'websocket';
  return undefined;
}

function isCurlSpawn(node, { module, name }) {
  const command = unwrap(node.arguments?.[0]);
  return (
    childProcessModule.test(module) &&
    name === 'spawn' &&
    isLiteralString(command) &&
    command.text === 'curl'
  );
}

function deliveryDeclaration(entry) {
  const path = entry?.path.replace(`${virtualRoot}/`, '');
  const surfaces = deliverySurfaces.get(path);
  if (surfaces) {
    const node = entry.resolve();
    const name =
      nameOf(node) ?? (ts.isTypeAliasDeclaration(node.parent) ? nameOf(node.parent) : undefined);
    const kind = surfaces.get(name);
    if (kind) return `${kind}:${kind === 'http-fetch' ? 'fetch' : name}`;
  }
  if (path?.endsWith('/lib.dom.d.ts')) {
    const node = entry.resolve();
    if (nameOf(node) === 'fetch') return 'http-fetch:fetch';
    if (nameOf(node.parent) === 'WebSocket' && nameOf(node) === 'send') return 'websocket:send';
  }
  if (path === `${nodeTypes}http2.d.ts` && nameOf(entry.resolve()) === 'request')
    return 'http2:request';
  if (
    path?.startsWith('node_modules/@types/web-push/') &&
    nameOf(entry.resolve()) === 'sendNotification'
  )
    return 'web-push:sendNotification';
  if (path?.startsWith('node_modules/@types/nodemailer/') && nameOf(entry.resolve()) === 'sendMail')
    return 'smtp:sendMail';
  if (path?.startsWith('node_modules/@types/ws/') && nameOf(entry.resolve()) === 'send')
    return 'websocket:send';
  return undefined;
}
const dependencyRules = [
  [
    'sql-dependency',
    /^(?:node:sqlite|bun:sqlite|better-sqlite3|sqlite3|drizzle-orm(?:\/.*)?)$|(?:^|\/)db\/(?:client|schema)(?:\.[cm]?[jt]s)?$/,
  ],
  ['file-dependency', fileModule],
  ['network-dependency', { test: networkModule }],
  [
    'process-dependency',
    /^(?:node:)?(?:child_process|worker_threads)$|^(?:execa|simple-git|isomorphic-git)(?:\/.*)?$|^@modelcontextprotocol\/sdk\/client\/stdio(?:\.js)?$/,
  ],
  [
    'credential-dependency',
    {
      test: (specifier) =>
        credentialModule.test(specifier) ||
        /(?:^|\/)(?:secrets|credentials|api-keys|github-app-token|github-autonomous-token)(?:\.[cm]?[jt]s)?$/.test(
          specifier,
        ),
    },
  ],
];
const schemaModule = /(?:^|\/)db\/schema(?:\.[cm]?[jt]s)?$/;
const rawSqlMethods = new Set([
  'run',
  'all',
  'get',
  'iterate',
  'values',
  'execute',
  'prepare',
  'exec',
]);
const rawSqlReceivers = new Set([
  'BaseSQLiteDatabase',
  'SQLiteSession',
  'Database',
  'DatabaseSync',
  'SQLTagStore',
]);
const mutationMethods = new Set(['values', 'set', 'select', 'onConflictDoUpdate']);
const legacyFileEffect =
  /^(?:readFile|writeFile|appendFile|copyFile|open|mkdir|readdir|opendir|rename|unlink|rm|rmdir|realpath|stat|lstat|mkdtemp|readlink|symlink|access|createReadStream|createWriteStream)(?:Sync)?$/;
const fileEffect =
  /^(?:readFile|writeFile|appendFile|copyFile|cp|open|openAsBlob|mkdir|readdir|opendir|rename|unlink|rm|rmdir|realpath|stat|lstat|fstat|statfs|mkdtemp|readlink|link|symlink|access|exists|createReadStream|createWriteStream|chmod|chown|fchmod|fchown|lchmod|lchown|truncate|ftruncate|utimes|futimes|lutimes|fsync|fdatasync|watch|watchFile|unwatchFile|glob|close|read|write|readv|writev)(?:Sync)?$/;
const fileHandleEffect =
  /^(?:read|write|readv|writev|readFile|writeFile|appendFile|close|sync|datasync|stat|truncate|chmod|chown|utimes|createReadStream|createWriteStream|readLines|readableWebStream)$/;
const childProcessModule = /^(?:node:)?child_process$/;
const workerModule = /^(?:node:)?worker_threads$/;
const childProcessMethods = [
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'spawn',
  'spawnSync',
  'fork',
];
const processWrappers = new Set(['runGit', 'runGitOk', 'spawnContainedCommand', 'spawnProcess']);
const hubEffect =
  /^(?:publish(?:TodoDoc|BuildDoc|Notification|Private|Message|TextDelta|ThinkingDelta|Activity|AgentTodo|Step)?|clearConversationBuffer)$/;
const scopeOpeners = new Set(['openRequestScope', 'openJobScope']);
const operationRules = [
  ['bare-step-lookup', /\.from\s*\(\s*step\s*\)\s*\.where\s*\(\s*eq\s*\(\s*step\.id\s*,/],
  ['message-id-only-conflict', /\btarget\s*:\s*message\s*\.\s*id\b/],
  ['runner-caller-chosen-transcript-id', /\bid\s*:\s*row\s*\.\s*id\s*,/],
  ['watchdog-gate-verdict-control-flow', /\.from\s*\(\s*gateVerdict\s*\)/],
  ['watchdog-repeated-failure-control-flow', /\bisNotNull\s*\(\s*build\s*\.\s*errorMessage\s*\)/],
  ['watchdog-unbranded-snippet', /\bnotifyWatchdogFlag\s*\([^)]*\bsnippet\b/],
  ['attachment-path-handoff', /\babsPath\s*:\s*join\s*\(/],
  ['attachment-path-reopen', /\{[^{}]*\babsPath\b[^{}]*\}\s*=\s*readAttachment\s*\(/],
  ['raw-hub-publication', /\bpublish\s*\(\s*teamId\s*:\s*string\b/],
  ['raw-connector-handoff', /\bawait\s+stepConnectorEndpoints\s*\(/],
  ['caller-chosen-owner', /\bteamId\s*:\s*ctx\s*\.\s*team\s*\.\s*id\b/],
];
const operationalRules = [
  ['sqlite-cli-open', /(?:^|[\s(])sqlite3\s+/],
  ['raw-side-store-backup', /(?:^|[\s'"])\.backup\s/],
  ['indirect-offline-opener', /\bsqlite3\s*\.\s*connect\s*\(/],
];
const virtualRoot = '/cairn-team-scope-inventory';
const virtualConfig = `${virtualRoot}/tsconfig.json`;
const transparentExpressions = new Set([
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.TypeAssertionExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.SatisfiesExpression,
]);

function unwrap(node) {
  while (node && transparentExpressions.has(node.kind)) node = node.expression;
  return node;
}

function propertyReceiver(node) {
  return node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    ? unwrap(node.expression)
    : undefined;
}

function isLiteralString(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
}

function signedNumericKey(node) {
  return node &&
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
    ? String(-Number(node.operand.text))
    : undefined;
}

function referenceNode(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node)) return node;
  if (ts.isPropertyAccessExpression(node)) return node.name;
  if (
    ts.isElementAccessExpression(node) &&
    (isLiteralString(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression))
  )
    return node.argumentExpression;
  return undefined;
}

function expressionName(node) {
  return referenceNode(node)?.text;
}

function expressionLabel(node) {
  const receiver = propertyReceiver(node);
  const name = expressionName(node);
  if (receiver && name !== undefined) return `${expressionLabel(receiver)}.${name}`;
  return name ?? node.getText();
}

function assignmentOwner(node) {
  let parent = node.parent;
  while (parent && transparentExpressions.has(parent.kind)) parent = parent.parent;
  return parent &&
    (ts.isVariableDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    unwrap(parent.initializer) === node
    ? parent
    : undefined;
}

function nameOf(node) {
  return node?.name?.text ?? node?.name?.getText();
}

function namedFrame(node) {
  if (ts.isFunctionLikeDeclaration(node) && node.body) {
    const owner = assignmentOwner(node) ?? node;
    const name = nameOf(owner) ?? (ts.isConstructorDeclaration(node) ? 'constructor' : undefined);
    if (name !== undefined) return { node, name, callable: owner.id };
  }
  if (
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isObjectLiteralExpression(node)
  ) {
    const name = nameOf(assignmentOwner(node) ?? node);
    if (name !== undefined) return { node, name };
  }
  return undefined;
}

function moduleUse(node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    isLiteralString(node.moduleSpecifier)
  ) {
    return { node, specifier: node.moduleSpecifier.text, reexport: ts.isExportDeclaration(node) };
  }
  if (ts.isExternalModuleReference(node) && isLiteralString(node.expression))
    return { node: node.parent, specifier: node.expression.text };
  if (ts.isCallExpression(node)) {
    const expression = unwrap(node.expression);
    if (
      expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(expression) && expression.text === 'require')
    ) {
      const [specifier] = node.arguments;
      return { node, specifier: isLiteralString(specifier) ? specifier.text : undefined };
    }
  }
  return undefined;
}

function analyzeFile(file) {
  const analysis = { file, modules: [], calls: [], frames: [], handoffs: [] };
  const frames = [];
  const visit = (node, variable) => {
    const frame = namedFrame(node);
    if (frame) {
      frames.push(frame);
      analysis.frames.push({ ...frame, start: node.getStart() });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      variable = node.name.text;
    }
    if (
      ts.isPropertyAssignment(node) &&
      (expressionName(unwrap(node.initializer)) === 'fetch' ||
        /^(?:fetch|fetchImpl)$/.test(nameOf(node)))
    ) {
      analysis.handoffs.push({
        node,
        location: frames.map(({ name }) => name).join('.') || variable || '<module>',
      });
    }
    const module = moduleUse(node);
    if (module?.specifier !== undefined) analysis.modules.push(module);
    if (
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isTaggedTemplateExpression(node)
    ) {
      const expression = unwrap(ts.isTaggedTemplateExpression(node) ? node.tag : node.expression);
      const callables = frames.filter(({ callable }) => callable !== undefined);
      analysis.calls.push({
        node,
        expression,
        owner: callables.at(-1)?.callable,
        root: callables[0]?.callable,
        location: frames.map(({ name }) => name).join('.') || variable || '<module>',
        unresolvedLoader: module !== undefined && module.specifier === undefined,
      });
    }
    node.forEachChild((child) => visit(child, variable));
    if (frame) frames.pop();
  };
  visit(file);
  return analysis;
}

function importBinding(declaration) {
  if (!declaration) return undefined;
  if (ts.isImportSpecifier(declaration)) {
    return {
      name: (declaration.propertyName ?? declaration.name).text,
      module: declaration.parent.parent.parent.moduleSpecifier.text,
    };
  }
  if (ts.isNamespaceImport(declaration)) {
    return { module: declaration.parent.parent.moduleSpecifier.text };
  }
  if (ts.isImportClause(declaration)) {
    return { module: declaration.parent.moduleSpecifier.text };
  }
  return undefined;
}

function credentialDeclarations(checker, program) {
  const targets = new Map();
  const paths = new Set([...credentialSources.keys()].map((path) => `${virtualRoot}/${path}`));
  const add = (declaration, name) => {
    if (declaration && paths.has(declaration.path))
      targets.set(`${declaration.path}:${declaration.index}`, name);
  };
  for (const path of paths) {
    const module = checker.getSymbolAtLocation(program.getSourceFile(path));
    if (!module) continue;
    for (const exported of checker.getExportsOfModule(module)) {
      const module = posix.basename(path, '.ts');
      const mark = (declaration, name) => add(declaration, { module, name });
      for (const declaration of exported.declarations) mark(declaration, exported.name);
      if (!(exported.flags & SymbolFlags.Type)) continue;
      const type = checker.getDeclaredTypeOfSymbol(exported);
      for (const property of checker.getPropertiesOfType(type)) {
        const member = `${exported.name}.${property.name}`;
        for (const declaration of property.declarations) mark(declaration, member);
        const propertyType = checker.getTypeOfSymbol(property);
        if (!propertyType) continue;
        for (const { declaration } of checker.getSignaturesOfType(
          checker.getNonNullableType(propertyType),
          SignatureKind.Call,
        ))
          mark(declaration, member);
      }
    }
  }
  return (declaration) =>
    declaration && paths.has(declaration.path)
      ? targets.get(`${declaration.path}:${declaration.index}`)
      : undefined;
}

function classifyInvocations(checker, program, analyses, tables) {
  const calls = [...analyses.values()].flatMap(({ calls }) => calls);
  const databaseMethods = new Set(databaseMethodSurfaces().flatMap(({ methods }) => methods));
  const dbPath = (path) =>
    path?.startsWith(`${virtualRoot}/`) &&
    isDatabaseDeclaration(path.slice(virtualRoot.length + 1));
  const references = new Set();
  const addReferences = (expression) => {
    const reference = referenceNode(expression);
    const receiver = propertyReceiver(expression);
    if (reference) references.add(reference);
    if (receiver && ts.isIdentifier(receiver)) references.add(receiver);
  };
  for (const call of calls) {
    const { node, expression } = call;
    addReferences(expression);
    if (ts.isCallExpression(node) && ['insert', 'update'].includes(expressionName(expression))) {
      const table = unwrap(node.arguments[0]);
      if (table) {
        call.table = table;
        addReferences(table);
      }
    }
  }

  const symbols = new Map();
  const nodes = [...references];
  for (let start = 0; start < nodes.length; start += 1024) {
    const chunk = nodes.slice(start, start + 1024);
    const resolved = checker.getSymbolAtLocation(chunk);
    for (const [index, node] of chunk.entries()) symbols.set(node, resolved[index]);
  }
  const deliveryByDeclaration = new Map();
  const deliveryOperationOf = (entry) => {
    if (!entry) return undefined;
    const key = `${entry.path}:${entry.index}`;
    if (!deliveryByDeclaration.has(key)) deliveryByDeclaration.set(key, deliveryDeclaration(entry));
    return deliveryByDeclaration.get(key);
  };
  const declarations = new Map();
  const declaration = (symbol) => {
    if (!symbol) return undefined;
    if (!declarations.has(symbol.id)) {
      declarations.set(symbol.id, (symbol.valueDeclaration ?? symbol.declarations[0])?.resolve());
    }
    return declarations.get(symbol.id);
  };
  const driverBinding = (expression, seen = new Set()) => {
    expression = unwrap(expression);
    if (!expression) return undefined;
    if (ts.isAwaitExpression(expression)) return driverBinding(expression.expression, seen);
    const loader = moduleUse(expression);
    if (sqliteDrivers.has(loader?.specifier)) return { module: loader.specifier };
    if (ts.isNewExpression(expression)) {
      const binding = driverBinding(expression.expression, seen);
      if (binding) return { ...binding, instance: true };
    }
    if (ts.isCallExpression(expression)) {
      const binding = driverBinding(expression.expression, seen);
      if (binding?.module === 'sqlite3' && binding.name === 'verbose') return { module: 'sqlite3' };
    }
    const receiver = propertyReceiver(expression);
    if (receiver) {
      const binding = driverBinding(receiver, seen);
      const name = expressionName(expression);
      if (binding && name !== undefined) return { ...binding, name, memberOf: binding.name };
    }
    if (!ts.isIdentifier(expression)) return undefined;
    if (!symbols.has(expression)) {
      symbols.set(expression, checker.getSymbolAtLocation([expression])[0]);
    }
    const local = declaration(symbols.get(expression));
    if (!local || seen.has(local.id)) return undefined;
    seen.add(local.id);
    const binding = importBinding(local);
    if (binding) return binding;
    if (ts.isImportEqualsDeclaration(local)) {
      return { module: moduleUse(local.moduleReference)?.specifier };
    }
    if (ts.isVariableDeclaration(local)) return driverBinding(local.initializer, seen);
    if (ts.isBindingElement(local) && ts.isObjectBindingPattern(local.parent)) {
      const binding = driverBinding(local.parent.parent.initializer, seen);
      const name = (local.propertyName ?? local.name).text;
      if (binding && name !== undefined) return { ...binding, name };
    }
    return undefined;
  };
  for (const [, analysis] of analyses) {
    if (!analysis.modules.some(({ specifier }) => sqliteDrivers.has(specifier))) continue;
    for (const call of analysis.calls) {
      const binding = driverBinding(call.expression);
      if (!sqliteDrivers.has(binding?.module)) continue;
      call.isSqliteOpen =
        (!binding.instance && sqliteDrivers.get(binding.module).includes(binding.name)) ||
        (binding.name === 'open' &&
          ((binding.module === 'bun:sqlite' && binding.memberOf === 'Database') ||
            (binding.module === 'node:sqlite' &&
              binding.memberOf === 'DatabaseSync' &&
              binding.instance)));
    }
  }
  const unaliased = new Map();
  const resolveAlias = (symbol) => {
    if (!symbol || !(symbol.flags & SymbolFlags.Alias)) return symbol;
    if (!unaliased.has(symbol.id)) unaliased.set(symbol.id, checker.getAliasedSymbol(symbol));
    return unaliased.get(symbol.id);
  };
  const targets = new Map();
  const target = (symbol) => {
    if (!symbol) return undefined;
    if (!targets.has(symbol.id)) {
      const local = declaration(symbol);
      targets.set(symbol.id, declaration(resolveAlias(symbol))?.id ?? local?.id);
    }
    return targets.get(symbol.id);
  };
  const symbolAt = (reference) => {
    if (reference && !symbols.has(reference))
      symbols.set(reference, checker.getSymbolAtLocation(reference));
    return symbols.get(reference);
  };
  const localDeclaration = (expression) => {
    const symbol = symbolAt(referenceNode(expression));
    return declaration(resolveAlias(symbol)) ?? declaration(symbol);
  };
  const credentialDeclaration = credentialDeclarations(checker, program);
  const credentialBinding = ({ module, name }) =>
    credentialModule.test(module) && name !== undefined;
  const credentialSymbol = (symbol) => {
    for (const entry of symbol?.declarations ?? []) {
      const credential = credentialDeclaration(entry);
      if (credential) return credential;
    }
    return undefined;
  };
  const boundOperations = (expression, seen = new Set()) => {
    expression = unwrap(expression);
    if (!expression || seen.has(expression)) return [];
    seen.add(expression);
    const name = expressionName(expression);
    const receiver = propertyReceiver(expression);
    if (receiver) {
      if (
        ts.isIdentifier(receiver) &&
        receiver.text === 'globalThis' &&
        !localDeclaration(receiver)
      )
        return [{ module: 'global', name }];
      const inherited = boundOperations(receiver, seen).flatMap((binding) => {
        if (['bind', 'call', 'apply'].includes(name)) return [binding];
        if (binding.module === 'git-ops') return [{ ...binding, name }];
        if (binding.resource === 'curl-process')
          return name === 'stdin' ? [{ ...binding, resource: 'curl-stdin', name }] : [];
        if (binding.resource) return [{ ...binding, name }];
        if (binding.module === 'process' && name === 'kill') return [{ ...binding, name }];
        if (binding.name === undefined || binding.name === 'default' || binding.name === 'promises')
          return [{ ...binding, name }];
        return [];
      });
      if (inherited.length) return inherited;
    }
    if (ts.isAwaitExpression(expression)) return boundOperations(expression.expression, seen);
    if (ts.isConditionalExpression(expression)) {
      return [
        ...boundOperations(expression.whenTrue, seen),
        ...boundOperations(expression.whenFalse, seen),
      ];
    }
    if (
      ts.isBinaryExpression(expression) &&
      ['??', '||'].includes(expression.operatorToken.getText())
    ) {
      return [
        ...boundOperations(expression.left, seen),
        ...boundOperations(expression.right, seen),
      ];
    }
    const loader = moduleUse(expression);
    if (loader?.specifier) return [{ module: loader.specifier }];
    if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
      const method = unwrap(expression.expression);
      if (expressionName(method) === 'promisify')
        return boundOperations(expression.arguments?.[0], seen);
      if (expressionName(method) === 'bind') {
        return boundOperations(method, seen).map((binding) => ({
          ...binding,
          bound: expression.getText(),
        }));
      }
      return boundOperations(method, seen).flatMap((binding) => {
        if (fileModule.test(binding.module) && binding.name === 'open')
          return [{ ...binding, resource: 'file-handle' }];
        if (isCurlSpawn(expression, binding)) return [{ ...binding, resource: 'curl-process' }];
        if (
          networkMethods.get(binding.module.replace(/^node:/, ''))?.has(binding.name) &&
          !['fetch', 'setGlobalDispatcher'].includes(binding.name)
        )
          return [{ ...binding, resource: 'network-handle' }];
        return [];
      });
    }
    if (name === undefined) return [];
    const symbol = symbolAt(referenceNode(expression));
    const original = importBinding(declaration(symbol));
    const local = localDeclaration(expression);
    if (original?.name === 'systemGitOps' || nameOf(local) === 'systemGitOps')
      return [{ module: 'git-ops' }];
    if (original && (!original.module.startsWith('.') || credentialModule.test(original.module)))
      return [original];
    const credential = credentialSymbol(resolveAlias(symbol));
    if (credential) return [credential];
    if (original && local && ts.isExportSpecifier(local)) {
      const specifier = local.parent.parent.moduleSpecifier;
      if (isLiteralString(specifier))
        return [{ module: specifier.text, name: (local.propertyName ?? local.name).text }];
    }
    if (
      !receiver &&
      ['fetch', 'WebSocket'].includes(name) &&
      (!local || /\/lib\.(?:dom|webworker)\.d\.ts$/.test(local.getSourceFile().fileName))
    )
      return [{ module: 'global', name }];
    if (!local && !receiver && name === 'process') return [{ module: 'process' }];
    if (local?.type && networkFetchType.test(local.type.getText()))
      return [{ module: 'global', name: 'fetch' }];
    if (local && ts.isBindingElement(local) && ts.isObjectBindingPattern(local.parent)) {
      return boundOperations(local.parent.parent.initializer, seen).map((binding) => ({
        ...binding,
        name: (local.propertyName ?? local.name).text,
      }));
    }
    if (
      local &&
      (ts.isVariableDeclaration(local) ||
        ts.isParameterDeclaration(local) ||
        ts.isPropertyDeclaration(local))
    )
      return boundOperations(local.initializer, seen).map((binding) =>
        credentialBinding(binding)
          ? {
              ...binding,
              bound: [binding.bound, `via ${local.getText()}`].filter(Boolean).join(' '),
            }
          : binding,
      );
    return [];
  };
  const processBinding = ({ module, name }) =>
    (childProcessModule.test(module) && childProcessMethods.includes(name)) ||
    (workerModule.test(module) && name === 'Worker') ||
    (module === 'process' && name === 'kill') ||
    (module === 'git-ops' && name !== undefined) ||
    (module.startsWith('@modelcontextprotocol/sdk/client/stdio') &&
      name === 'StdioClientTransport');
  const fileBinding = ({ module, name, resource }) =>
    fileModule.test(module) &&
    (resource === 'file-handle' ? fileHandleEffect : fileEffect).test(name);
  const networkBinding = ({ module, name, resource }) => {
    if (resource === 'network-handle') return networkMember.test(name);
    const source = module.replace(/^node:/, '');
    return networkMethods.get(source)?.has(name) || streamHelpers.get(source)?.has(name);
  };
  const isZodSchema = (expression, seen = new Set()) => {
    expression = unwrap(expression);
    if (!expression || seen.has(expression)) return false;
    seen.add(expression);
    if (ts.isCallExpression(expression)) return isZodSchema(expression.expression, seen);
    const receiver = propertyReceiver(expression);
    if (receiver) return isZodSchema(receiver, seen);
    const imported = importBinding(declaration(symbolAt(referenceNode(expression))));
    if (/^zod(?:\/|$)/.test(imported?.module ?? '')) return true;
    const local = localDeclaration(expression);
    return local && ts.isVariableDeclaration(local) && isZodSchema(local.initializer, seen);
  };
  const streamHandoff = (expression, seen = new Set()) => {
    expression = unwrap(expression);
    if (!expression || seen.has(expression)) return undefined;
    seen.add(expression);
    const receiver = propertyReceiver(expression);
    const name = expressionName(expression);
    if (receiver && streamMembers.has(name) && !isZodSchema(receiver)) return `stream:${name}`;
    if (receiver && ['call', 'apply'].includes(name)) return streamHandoff(receiver, seen);
    if (ts.isCallExpression(expression) && expressionName(expression.expression) === 'bind') {
      const binding = streamHandoff(propertyReceiver(expression.expression), seen);
      return binding && `${binding} ${expression.getText()}`;
    }
    if (!ts.isIdentifier(expression)) return undefined;
    const local = localDeclaration(expression);
    if (local && ts.isVariableDeclaration(local)) {
      const binding = streamHandoff(local.initializer, seen);
      return binding && `${binding} via ${local.getText()}`;
    }
    if (local && ts.isBindingElement(local) && ts.isObjectBindingPattern(local.parent)) {
      const method = (local.propertyName ?? local.name).text;
      const source = local.parent.parent.initializer;
      if (streamMembers.has(method) && !isZodSchema(source))
        return `stream:${method} ${local.getText()} from ${source?.getText() ?? local.parent.parent.getText()}`;
    }
    return undefined;
  };
  const dbMember = (expression, seen = new Set(), bindings = []) => {
    expression = unwrap(expression);
    if (!expression || seen.has(expression)) return undefined;
    seen.add(expression);
    const reference = referenceNode(expression);
    const receiver = propertyReceiver(expression);
    const symbol = symbolAt(reference);
    const member = symbol?.declarations.find(({ path }) => dbPath(path));
    if (member) return member;
    if (receiver && ['bind', 'call', 'apply'].includes(expressionName(expression)))
      return dbMember(receiver, seen, bindings);
    if (
      ts.isCallExpression(expression) &&
      expressionName(unwrap(expression.expression)) === 'bind'
    ) {
      bindings.push(expression.getText());
      return dbMember(expression.expression, seen, bindings);
    }
    if (!ts.isIdentifier(expression)) return undefined;
    const local = localDeclaration(expression);
    if (local && ts.isVariableDeclaration(local))
      return dbMember(local.initializer, seen, bindings);
    if (local && ts.isBindingElement(local) && ts.isObjectBindingPattern(local.parent)) {
      const owner = local.parent.parent;
      const type = owner.initializer && checker.getTypeAtLocation(owner.initializer);
      return (
        type &&
        checker
          .getPropertyOfType(type, (local.propertyName ?? local.name).text)
          ?.declarations.find(({ path }) => dbPath(path))
      );
    }
    return undefined;
  };
  const tableOf = (expression, seen = new Set()) => {
    const local = localDeclaration(expression);
    if (local && !seen.has(local)) {
      seen.add(local);
      if (local.getSourceFile().fileName === `${virtualRoot}/${schemaPath}`) return nameOf(local);
      if (ts.isVariableDeclaration(local)) return tableOf(unwrap(local.initializer), seen);
    }
    const binding = importBinding(declaration(symbols.get(referenceNode(expression))));
    const namespace = importBinding(declaration(symbolAt(propertyReceiver(expression))));
    if (schemaModule.test(binding?.module ?? '')) return binding.name;
    if (schemaModule.test(namespace?.module ?? '')) return expressionName(expression);
    return undefined;
  };
  const sqlIdentifier = (expression, member) => {
    const table = tables.get(tableOf(expression));
    const name = member
      ? table?.columns.find(({ property }) => property === member)?.sql
      : table?.name;
    return name && `"${name.replaceAll('"', '""')}"`;
  };
  const callers = new Map();
  const operations = (bindings, matches, spelling, includeDirect = false) => {
    const found = bindings.filter(matches);
    if (!includeDirect && found.every(({ name, bound }) => name === spelling && !bound)) return [];
    return [
      ...new Set(
        found.map(({ module, name, bound }) =>
          bound ? `${module}:${name} ${bound}` : `${module}:${name}`,
        ),
      ),
    ].sort();
  };
  for (const call of calls) {
    const { expression, table, node } = call;
    if (table) call.tableSymbol = tableOf(table);
    const name = expressionName(expression);
    const reference = referenceNode(expression);
    const receiver = propertyReceiver(expression);
    const sqlBindings = [];
    const sqliteMember = ts.isNewExpression(node)
      ? undefined
      : dbMember(expression, new Set(), sqlBindings);
    const local =
      !sqliteMember && !receiver && ts.isIdentifier(expression)
        ? localDeclaration(expression)
        : undefined;
    const initializer =
      local && ts.isVariableDeclaration(local) ? unwrap(local.initializer) : undefined;
    const mayBeTransaction =
      initializer &&
      ts.isCallExpression(initializer) &&
      expressionName(unwrap(initializer.expression)) === 'transaction';
    const signature =
      !sqliteMember &&
      !ts.isNewExpression(node) &&
      (mayBeTransaction ||
        (!reference && (receiver || ts.isCallExpression(expression))) ||
        (receiver && databaseMethods.has(name) && !symbols.get(reference)))
        ? checker.getResolvedSignature(node)?.declaration
        : undefined;
    const method = sqliteMember ?? (dbPath(signature?.path) ? signature : undefined);
    call.isDatabase = method !== undefined;
    const methodDeclaration =
      method && (rawSqlMethods.has(name) || !receiver || !name || ['call', 'apply'].includes(name))
        ? method.resolve()
        : undefined;
    const resolvedName = nameOf(methodDeclaration) ?? name;
    if (method && resolvedName && resolvedName !== name) sqlBindings.push(resolvedName);
    call.sqlBindings = sqlBindings;
    const binding = ts.isTaggedTemplateExpression(node)
      ? importBinding(declaration(symbols.get(reference)))
      : undefined;
    const rawBinding =
      receiver && name === 'raw'
        ? importBinding(declaration(symbolAt(referenceNode(receiver))))
        : undefined;
    call.isSqlExpression = [binding, rawBinding].some(
      (binding) =>
        /^drizzle-orm(?:\/sql(?:\/.*)?)?$/.test(binding?.module ?? '') && binding.name === 'sql',
    );
    if (receiver && databaseMethods.has(name) && !symbols.get(reference)) {
      call.unresolvedDatabaseMethod = true;
    }
    if ((call.isDatabase || call.unresolvedDatabaseMethod) && rawSqlMethods.has(resolvedName)) {
      const args = node.arguments;
      const arg = ts.isTaggedTemplateExpression(node)
        ? node.template
        : name === 'apply' && args?.[1] && ts.isArrayLiteralExpression(unwrap(args[1]))
          ? unwrap(args[1]).elements[0]
          : args?.[name === 'call' ? 1 : 0];
      if (arg) {
        call.rawSql = sqlText(arg, localDeclaration, sqlIdentifier, sqlBindings);
      }
      call.opaqueSql =
        call.rawSql === undefined && rawSqlReceivers.has(nameOf(methodDeclaration?.parent));
    }
    if (ts.isTaggedTemplateExpression(node)) continue;
    const bindings = boundOperations(expression);
    call.isFile = bindings.some(fileBinding);
    call.fileOperations = operations(bindings, fileBinding, name);
    call.networkOperations = operations(bindings, networkBinding, name, true);
    const localTarget = localDeclaration(expression);
    if (ts.isCallExpression(node) && !(receiver && name === 'bind')) {
      call.deliveryOperations = new Set(
        bindings.flatMap((binding) => {
          const kind = deliveryBinding(binding);
          if (
            kind === 'http-fetch' &&
            localTarget?.body &&
            ts.isFunctionLikeDeclaration(localTarget)
          )
            return [];
          return kind ? [`${kind}:${binding.name}${binding.bound ? ` ${binding.bound}` : ''}`] : [];
        }),
      );
      if (bindings.some((binding) => isCurlSpawn(node, binding)))
        call.deliveryOperations.add('curl:spawn');
      for (const entry of resolveAlias(symbolAt(reference))?.declarations ?? []) {
        const operation = deliveryOperationOf(entry);
        if (operation) call.deliveryOperations.add(operation);
      }
    }
    if (ts.isNewExpression(node)) call.deliveryOperations = new Set();
    const transfer = ts.isCallExpression(node) && streamHandoff(expression);
    if (transfer) call.networkOperations.push(transfer);
    call.processOperations = operations(bindings, processBinding, name);
    const imported = importBinding(declaration(symbols.get(reference)));
    call.isProcess = bindings.some(processBinding) || processWrappers.has(imported?.name ?? name);
    if (
      bindings.some(
        ({ module, name }) => module === 'drizzle-orm/better-sqlite3' && name === 'drizzle',
      )
    ) {
      const arg = unwrap(node.arguments?.[0]);
      call.isSqliteOpen ||=
        isLiteralString(arg) ||
        (arg &&
          ts.isObjectLiteralExpression(arg) &&
          arg.properties.some((p) => nameOf(p) === 'connection'));
    }
    if (ts.isCallExpression(node)) {
      call.credentialOperations = operations(bindings, credentialBinding, name, true);
      call.resolveCredentialType =
        !call.credentialOperations.length &&
        ((receiver && !reference) ||
          (localTarget &&
            (ts.isBindingElement(localTarget) ||
              (localTarget.type && !ts.isFunctionLikeDeclaration(localTarget)))));
      call.resolveDeliveryType =
        call.deliveryOperations?.size === 0 &&
        (call.resolveCredentialType ||
          !reference ||
          ['request', 'send', 'sendMail', 'sendNotification'].includes(name) ||
          (localTarget &&
            ts.isVariableDeclaration(localTarget) &&
            localTarget.initializer &&
            !ts.isFunctionLikeDeclaration(unwrap(localTarget.initializer))));
      if (receiver && ['write', 'end'].includes(name)) call.deliveryReceiver = receiver;
    }
    const id =
      ts.isNewExpression(node) && localTarget && ts.isClassDeclaration(localTarget)
        ? localTarget.members.find(ts.isConstructorDeclaration)?.id
        : target(symbols.get(reference));
    if (id !== undefined) {
      if (!callers.has(id)) callers.set(id, []);
      callers.get(id).push(call);
    }
  }
  const credentialCandidates = calls.filter(({ resolveCredentialType }) => resolveCredentialType);
  for (let start = 0; start < credentialCandidates.length; start += 1024) {
    const chunk = credentialCandidates.slice(start, start + 1024);
    const types = checker.getTypeAtLocation(chunk.map(({ expression }) => expression));
    for (const [index, call] of chunk.entries()) {
      const type = types[index];
      const variants = type?.isUnionType() || type?.isIntersectionType() ? type.getTypes() : [type];
      const bindings = variants.flatMap((variant) => {
        const credential = variant && credentialSymbol(variant.getSymbol());
        return credential ? [credential] : [];
      });
      call.credentialOperations = operations(bindings, credentialBinding, undefined, true);
    }
  }
  const signatureDeliveries = new Map();
  const deliveryCandidates = calls.filter(
    ({ resolveDeliveryType, deliveryReceiver }) => resolveDeliveryType || deliveryReceiver,
  );
  for (let start = 0; start < deliveryCandidates.length; start += 1024) {
    const chunk = deliveryCandidates.slice(start, start + 1024);
    const types = checker.getTypeAtLocation(
      chunk.map(({ deliveryReceiver, expression }) => deliveryReceiver ?? expression),
    );
    for (const [index, call] of chunk.entries()) {
      const type = types[index];
      const variants = type?.isUnionType() || type?.isIntersectionType() ? type.getTypes() : [type];
      for (const variant of variants) {
        if (!variant) continue;
        if (call.deliveryReceiver) {
          const symbol = variant.getSymbol();
          const kind =
            symbol?.declarations.some(
              ({ path }) => path === `${virtualRoot}/${nodeTypes}http2.d.ts`,
            ) && symbol.name === 'ClientHttp2Stream'
              ? 'http2'
              : symbol?.declarations.some(
                    ({ path }) => path === `${virtualRoot}/${nodeTypes}http.d.ts`,
                  ) && symbol.name === 'ClientRequest'
                ? 'http-request'
                : undefined;
          if (kind) call.deliveryOperations.add(`${kind}:${expressionName(call.expression)}`);
        } else {
          if (!signatureDeliveries.has(variant.id)) {
            signatureDeliveries.set(
              variant.id,
              checker
                .getSignaturesOfType(variant, SignatureKind.Call)
                .map(({ declaration }) => deliveryOperationOf(declaration))
                .filter(Boolean),
            );
          }
          for (const operation of signatureDeliveries.get(variant.id))
            call.deliveryOperations.add(operation);
        }
      }
    }
  }
  const deliveryCallers = new Map([...callers].map(([id, entries]) => [id, [...entries]]));
  const assignments = new Map();
  for (const { file } of analyses.values()) {
    const visit = (node) => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const local = localDeclaration(unwrap(node.left));
        if (local) {
          if (!assignments.has(local.id)) assignments.set(local.id, []);
          assignments.get(local.id).push(node);
        }
      }
      node.forEachChild(visit);
    };
    visit(file);
  }
  const assignmentDeliveryRoots = new Map();
  const computedDeliveryMembers = (type, expression) => {
    const members = type ? checker.getPropertiesOfType(type) : [];
    const key = target(symbolAt(referenceNode(expression)));
    if (key === undefined) return members;
    const matches = members.filter((member) =>
      member.declarations.some((entry) => {
        const property = entry.resolve().name;
        return (
          property &&
          ts.isComputedPropertyName(property) &&
          target(symbolAt(referenceNode(unwrap(property.expression)))) === key
        );
      }),
    );
    return matches.length ? matches : members;
  };
  const followDeliveryDeclaration = (local, bindings, targets, seen) => {
    if (!local || seen.has(local)) return;
    seen.add(local);
    for (const assignment of assignments.get(local.id) ?? []) {
      bindings.push(assignment.getText());
      const roots = assignmentDeliveryRoots.get(bindings);
      for (const binding of boundOperations(assignment.right)) {
        const kind = deliveryBinding(binding);
        if (kind) roots.add(`${kind}:${binding.name}`);
      }
      for (const entry of resolveAlias(symbolAt(referenceNode(unwrap(assignment.right))))
        ?.declarations ?? []) {
        const operation = deliveryOperationOf(entry);
        if (operation) roots.add(operation);
      }
      aliasTarget(assignment.right, bindings, targets, seen);
    }
    if (ts.isShorthandPropertyAssignment(local)) {
      bindings.push(local.getText());
      const symbol = checker.getShorthandAssignmentValueSymbol(local);
      followDeliveryDeclaration(declaration(resolveAlias(symbol)), bindings, targets, seen);
      return;
    }
    if (ts.isBindingElement(local) && ts.isObjectBindingPattern(local.parent)) {
      bindings.push(local.getText());
      const source = local.parent.parent.initializer;
      const type = source && checker.getTypeAtLocation(source);
      const property = local.propertyName ?? local.name;
      const computed = ts.isComputedPropertyName(property)
        ? unwrap(property.expression)
        : undefined;
      if (computed) aliasTarget(computed, bindings, new Set(), seen);
      const name = computed
        ? isLiteralString(computed) || ts.isNumericLiteral(computed)
          ? computed.text
          : signedNumericKey(computed)
        : property.text;
      const members = type
        ? name === undefined
          ? computedDeliveryMembers(type, computed)
          : [checker.getPropertyOfType(type, name)]
        : [];
      for (const member of members)
        followDeliveryDeclaration(declaration(resolveAlias(member)), bindings, targets, seen);
      return;
    }
    if (
      (ts.isVariableDeclaration(local) ||
        ts.isPropertyAssignment(local) ||
        ts.isPropertyDeclaration(local)) &&
      local.initializer
    ) {
      const initializer = unwrap(local.initializer);
      if (!ts.isFunctionLikeDeclaration(initializer)) {
        bindings.push(local.getText());
        aliasTarget(initializer, bindings, targets, seen);
      }
    }
    if (ts.isClassDeclaration(local) || ts.isClassExpression(local)) {
      const initializer = local.members.find(ts.isConstructorDeclaration);
      if (initializer) targets.add(initializer.id);
    }
    targets.add(local.id);
  };
  const aliasTarget = (expression, bindings, targets, seen = new Set()) => {
    expression = unwrap(expression);
    if (!expression || seen.has(expression)) return;
    seen.add(expression);
    if (ts.isConditionalExpression(expression)) {
      bindings.push(expression.getText());
      aliasTarget(expression.whenTrue, bindings, targets, seen);
      aliasTarget(expression.whenFalse, bindings, targets, seen);
      return;
    }
    if (
      ts.isBinaryExpression(expression) &&
      ['??', '||', '&&'].includes(expression.operatorToken.getText())
    ) {
      bindings.push(expression.getText());
      aliasTarget(expression.left, bindings, targets, seen);
      aliasTarget(expression.right, bindings, targets, seen);
      return;
    }
    if (ts.isCallExpression(expression) && expressionName(expression.expression) === 'bind') {
      bindings.push(expression.getText());
      return aliasTarget(propertyReceiver(expression.expression), bindings, targets, seen);
    }
    const receiver = propertyReceiver(expression);
    if (
      ts.isElementAccessExpression(expression) &&
      !isLiteralString(expression.argumentExpression) &&
      !ts.isNumericLiteral(expression.argumentExpression) &&
      signedNumericKey(expression.argumentExpression) === undefined
    ) {
      aliasTarget(expression.argumentExpression, bindings, new Set(), seen);
      const type = checker.getTypeAtLocation(expression.expression);
      for (const member of computedDeliveryMembers(type, expression.argumentExpression))
        followDeliveryDeclaration(declaration(resolveAlias(member)), bindings, targets, seen);
    }
    if (receiver) {
      const local = localDeclaration(expression);
      const ownMethod =
        local &&
        !/\/lib\.[^/]+\.d\.ts$/.test(local.getSourceFile().fileName) &&
        (ts.isMethodDeclaration(local) ||
          ts.isFunctionDeclaration(local) ||
          ts.isPropertyAssignment(local) ||
          ts.isPropertyDeclaration(local) ||
          ((ts.isMethodSignatureDeclaration(local) || ts.isPropertySignatureDeclaration(local)) &&
            assignments.has(local.id)));
      aliasTarget(
        receiver,
        bindings,
        !ownMethod && ['call', 'apply'].includes(expressionName(expression)) ? targets : new Set(),
        seen,
      );
    }
    const local = localDeclaration(expression);
    followDeliveryDeclaration(local, bindings, targets, seen);
    const id = target(symbolAt(referenceNode(expression)));
    if (id !== undefined) targets.add(id);
  };
  for (const call of calls) {
    const bindings = [];
    assignmentDeliveryRoots.set(bindings, new Set());
    const targets = new Set();
    const expression = call.expression;
    const reflect =
      ts.isCallExpression(call.node) &&
      ts.isPropertyAccessExpression(expression) &&
      expression.expression.getText() === 'Reflect' &&
      (!localDeclaration(expression.expression) ||
        /\/lib\.[^/]+\.d\.ts$/.test(
          localDeclaration(expression.expression).getSourceFile().fileName,
        )) &&
      ['apply', 'construct'].includes(expression.name.text);
    aliasTarget(reflect ? call.node.arguments[0] : expression, bindings, targets);
    if (reflect && expression.name.text === 'construct') {
      const local = localDeclaration(call.node.arguments[0]);
      if (local && ts.isClassDeclaration(local)) {
        const initializer = local.members.find(ts.isConstructorDeclaration);
        if (initializer) targets.add(initializer.id);
      }
    }
    if (ts.isCallExpression(call.node) || ts.isNewExpression(call.node)) {
      const signature = checker.getResolvedSignature(call.node)?.declaration;
      if (signature) {
        const declaration = signature.resolve();
        targets.add(declaration.id);
        if (
          ts.isCallExpression(call.expression) &&
          ts.isFunctionLikeDeclaration(declaration) &&
          !namedFrame(declaration)
        ) {
          let parent = declaration.parent;
          while (parent && !namedFrame(parent)?.callable) parent = parent.parent;
          const owner = parent && namedFrame(parent)?.callable;
          if (owner !== undefined) targets.add(owner);
        }
      }
    }
    call.deliveryBindings = bindings;
    if (call.deliveryOperations) {
      for (const root of assignmentDeliveryRoots.get(bindings)) call.deliveryOperations.add(root);
    }
    if (call.deliveryOperations?.size) {
      for (const binding of bindings) call.deliveryOperations.add(`via ${binding}`);
    }
    for (const id of targets) {
      if (deliveryCallers.get(id)?.includes(call)) continue;
      if (!deliveryCallers.has(id)) deliveryCallers.set(id, []);
      deliveryCallers.get(id).push(call);
    }
  }
  const deliveries = calls.filter((call) => call.deliveryOperations?.size);
  for (const { owner } of deliveries) {
    for (const caller of deliveryCallers.get(owner) ?? []) {
      if (!caller.deliveryOperations || caller.deliveryOperations.size) continue;
      caller.deliveryOperations.add('delivery-wrapper');
      for (const binding of caller.deliveryBindings)
        caller.deliveryOperations.add(`via ${binding}`);
      deliveries.push(caller);
    }
  }
  const mutations = new Map(
    calls.filter(({ tableSymbol }) => tableSymbol).map((call) => [call.node, call]),
  );
  const mutationRoot = (expression, seen = new Set()) => {
    expression = unwrap(expression);
    if (!expression || seen.has(expression)) return undefined;
    seen.add(expression);
    if (mutations.has(expression)) return mutations.get(expression);
    if (ts.isCallExpression(expression))
      return mutationRoot(propertyReceiver(unwrap(expression.expression)), seen);
    const local = localDeclaration(expression);
    if (local && ts.isVariableDeclaration(local)) return mutationRoot(local.initializer, seen);
    return undefined;
  };
  for (const call of calls) {
    if (mutationMethods.has(expressionName(call.expression))) {
      call.mutation = mutationRoot(propertyReceiver(call.expression));
    }
  }
  for (const kind of ['isProcess', 'isSqliteOpen']) {
    const pending = calls.filter((call) => call[kind]);
    for (const { owner } of pending) {
      for (const caller of callers.get(owner) ?? []) {
        if (caller[kind]) continue;
        caller[kind] = true;
        pending.push(caller);
      }
    }
  }
  for (const { handoffs } of analyses.values()) {
    for (const handoff of handoffs) {
      handoff.networkOperations = operations(
        boundOperations(handoff.node.initializer),
        networkBinding,
        undefined,
        true,
      );
    }
  }
}

let compiler;
let compilerFiles;
let virtual;
const nativeTypes = 'node_modules/@types/node/sqlite.d.ts';
const installed = (path) =>
  path.startsWith(`${virtualRoot}/`)
    ? (databaseTypeFile(path.slice(virtualRoot.length + 1)) ??
      deliveryTypeFile(path.slice(virtualRoot.length + 1)))
    : undefined;

function compilerSnapshot(paths, sources) {
  const files = Object.fromEntries(
    paths.map((path) => [`${virtualRoot}/${path}`, sources.get(path)]),
  );
  files[`${virtualRoot}/${nativeTypes}`] = databaseTypeFile(nativeTypes);
  files[`${virtualRoot}/package.json`] = '{"type":"module"}';
  files[`${virtualRoot}/${schemaPath}`] ??= schemaSource;
  const referenceSources = new Map([...credentialSources, ...deliverySources]);
  for (const [path, source] of referenceSources) files[`${virtualRoot}/${path}`] ??= source;
  const transportTypes = ['http', 'https', 'http2'].map((name) => `${nodeTypes}${name}.d.ts`);
  for (const path of transportTypes) files[`${virtualRoot}/${path}`] = deliveryTypeFile(path);
  files[virtualConfig] = JSON.stringify({
    compilerOptions: {
      types: [],
      allowJs: true,
      module: 'nodenext',
      jsx: 'preserve',
      paths: {
        '@cairn/shared': [`./${sharedSecretBoxPath}`],
        ...Object.fromEntries(
          deliveryPackages.map((name) => [name, [`./node_modules/@types/${name}/index.d.ts`]]),
        ),
      },
    },
    files: [
      ...new Set([
        ...paths,
        nativeTypes,
        ...transportTypes,
        schemaPath,
        ...referenceSources.keys(),
      ]),
    ],
  });
  const previous = compilerFiles;
  compilerFiles = files;
  virtual = createVirtualFileSystem(files);
  if (!compiler) {
    compiler = new API({
      cwd: virtualRoot,
      fs: {
        readFile: (path) =>
          installed(path) ??
          (path.startsWith(`${virtualRoot}/`) ? virtual.readFile(path) : undefined),
        fileExists: (path) =>
          installed(path) != null ||
          (path.startsWith(`${virtualRoot}/`) ? virtual.fileExists(path) : undefined),
        directoryExists: (path) =>
          path.startsWith(`${virtualRoot}/node_modules`) ||
          (path.startsWith(virtualRoot) ? virtual.directoryExists(path) : undefined),
      },
    });
    process.once('exit', () => compiler.close());
    return compiler.updateSnapshot({ openProjects: [virtualConfig] });
  }
  const snapshot = compiler.updateSnapshot({
    fileChanges: {
      changed: Object.keys(files).filter(
        (path) => path in previous && previous[path] !== files[path],
      ),
      created: Object.keys(files).filter((path) => !(path in previous)),
      deleted: Object.keys(previous).filter((path) => !(path in files)),
    },
  });
  compiler.clearSourceFileCache();
  return snapshot;
}

let defaultTables;
function tableColumns(file) {
  const tables = new Map();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const { name, initializer } of statement.declarationList.declarations) {
      if (
        !initializer ||
        !ts.isCallExpression(initializer) ||
        expressionName(initializer.expression) !== 'sqliteTable'
      )
        continue;
      const [table, columns] = initializer.arguments;
      if (!isLiteralString(table) || !ts.isObjectLiteralExpression(columns)) continue;
      tables.set(name.text, {
        name: table.text,
        columns: columns.properties.map((property) => {
          let builder = property.initializer;
          while (
            builder &&
            ts.isCallExpression(builder) &&
            ts.isCallExpression(propertyReceiver(builder.expression) ?? builder.expression) &&
            propertyReceiver(builder.expression)
          )
            builder = propertyReceiver(builder.expression);
          const column = builder && ts.isCallExpression(builder) ? builder.arguments[0] : undefined;
          return {
            property: nameOf(property),
            sql: isLiteralString(column) ? column.text : nameOf(property),
          };
        }),
      });
    }
  }
  return tables;
}

function analyzeSources(sources) {
  const paths = [...sources.keys()].filter((path) => JS.test(path));
  if (paths.length === 0) return new Map();
  using snapshot = compilerSnapshot(paths, sources);
  const project = snapshot.getProject(virtualConfig);
  if (!project) throw new Error('Cannot load the team-scope inventory project');
  const { program, checker } = project;
  const diagnostics = program.getSyntacticDiagnostics();
  if (diagnostics.length) {
    const first = diagnostics[0];
    throw new Error(
      `Cannot parse team-scope inventory source: ${first.fileName ?? ''} TS${first.code}`,
    );
  }
  const schema = program.getSourceFile(`${virtualRoot}/${schemaPath}`);
  const expectedSchema = sources.get(schemaPath) ?? schemaSource;
  if (schema?.text !== expectedSchema) throw new Error(`Stale team-scope parse: ${schemaPath}`);
  if (expectedSchema === schemaSource) defaultTables ??= tableColumns(schema);
  const tables = expectedSchema === schemaSource ? defaultTables : tableColumns(schema);
  const analyses = new Map(
    paths.map((path) => {
      const file = program.getSourceFile(`${virtualRoot}/${path}`);
      if (!file) throw new Error(`Cannot parse team-scope inventory source: ${path}`);
      if (file.text !== sources.get(path)) throw new Error(`Stale team-scope parse: ${path}`);
      return [path, { ...analyzeFile(file), tables }];
    }),
  );
  classifyInvocations(checker, program, analyses, tables);
  return analyses;
}

function* invocationChain(node) {
  yield node;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      parent.expression !== node ||
      !(
        ts.isCallExpression(parent) ||
        ts.isPropertyAccessExpression(parent) ||
        ts.isElementAccessExpression(parent) ||
        transparentExpressions.has(parent.kind)
      )
    )
      break;
    yield parent;
    node = parent;
  }
}

function operationFingerprint(content, context = [], operations = []) {
  return context.length || operations.length
    ? JSON.stringify([content, ...operations, ...context])
    : content;
}

const abruptExits = new WeakMap();

function containsAbruptExit(node) {
  if (abruptExits.has(node)) return abruptExits.get(node);
  let found = false;
  const visit = (child) => {
    if (found || ts.isFunctionLikeDeclaration(child)) return;
    if (
      ts.isReturnStatement(child) ||
      ts.isThrowStatement(child) ||
      ts.isBreakStatement(child) ||
      ts.isContinueStatement(child)
    ) {
      found = true;
      return;
    }
    child.forEachChild(visit);
  };
  visit(node);
  abruptExits.set(node, found);
  return found;
}

function operationContext(node) {
  const contexts = [];
  for (let parent = node.parent; parent; node = parent, parent = node.parent) {
    if (parent.statements) {
      const index = parent.statements.indexOf(node);
      const guards = parent.statements.slice(0, Math.max(0, index)).filter(containsAbruptExit);
      if (guards.length)
        contexts.push(['preceding-exit', ...guards.map((guard) => guard.getText())]);
    }
    if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent)) {
      const condition = ts.isIfStatement(parent) ? parent.expression : parent.condition;
      if (node !== condition) {
        const positive = ts.isIfStatement(parent) ? parent.thenStatement : parent.whenTrue;
        contexts.push([node === positive ? 'then' : 'else', condition.getText()]);
      }
    } else if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
      contexts.push([
        'case',
        parent.parent.parent.expression.getText(),
        parent.expression?.getText() ?? 'default',
        ...parent.parent.clauses
          .slice(0, parent.parent.clauses.indexOf(parent))
          .map((clause) => clause.getText()),
      ]);
    } else if (ts.isTryStatement(parent)) {
      const branch =
        node === parent.tryBlock ? 'try' : node === parent.catchClause ? 'catch' : 'finally';
      contexts.push([
        'try-branch',
        branch,
        parent.catchClause?.variableDeclaration?.getText(),
        ...(branch === 'try' ? [] : [parent.tryBlock.getText()]),
      ]);
    } else if (
      ts.isBinaryExpression(parent) &&
      ['&&', '||', '??'].includes(parent.operatorToken.getText()) &&
      node === parent.right
    ) {
      contexts.push(['short-circuit', parent.operatorToken.getText(), parent.left.getText()]);
    } else if (
      ts.isWhileStatement(parent) ||
      ts.isDoStatement(parent) ||
      ts.isForStatement(parent) ||
      ts.isForOfStatement(parent) ||
      ts.isForInStatement(parent)
    ) {
      if (node === parent.statement) {
        contexts.push([
          'loop',
          parent.kind,
          parent.initializer?.getText(),
          parent.condition?.getText(),
          parent.expression?.getText(),
          parent.incrementor?.getText(),
        ]);
      }
    } else if (ts.isFunctionLikeDeclaration(parent) && parent.body && !namedFrame(parent)) {
      let callback = parent;
      while (transparentExpressions.has(callback.parent?.kind)) callback = callback.parent;
      const caller = callback.parent;
      if (caller && (ts.isCallExpression(caller) || ts.isNewExpression(caller))) {
        const index = caller.arguments?.indexOf(callback);
        if (index >= 0)
          contexts.push(['callback', expressionName(unwrap(caller.expression)), index]);
      }
    }
  }
  return contexts;
}

function sqlText(node, declaration, identifier, bindings, seen = new Set()) {
  node = unwrap(node);
  if (!node || seen.has(node)) return undefined;
  seen.add(node);
  if (isLiteralString(node)) return node.text;
  if (ts.isTemplateExpression(node))
    return (
      node.head.text +
      node.templateSpans
        .map(({ expression, literal }) => {
          const interpolation = unwrap(expression);
          let fragment;
          if (ts.isCallExpression(interpolation)) {
            const method = expressionName(unwrap(interpolation.expression));
            const arg = unwrap(interpolation.arguments[0]);
            if (method === 'raw')
              fragment = sqlText(arg, declaration, identifier, bindings, new Set(seen));
            if (method === 'identifier' && expressionName(arg) === 'name') {
              const column = propertyReceiver(arg);
              fragment = identifier(propertyReceiver(column), expressionName(column));
            }
          }
          return `${fragment ?? identifier(interpolation) ?? '?'}${literal.text}`;
        })
        .join('')
    );
  if (ts.isTaggedTemplateExpression(node))
    return sqlText(node.template, declaration, identifier, bindings, seen);
  if (ts.isIdentifier(node)) {
    const local = declaration(node);
    if (local && ts.isVariableDeclaration(local) && local.initializer) {
      bindings.push(local.initializer.getText());
      return sqlText(local.initializer, declaration, identifier, bindings, seen);
    }
  }
  if (ts.isCallExpression(node) && expressionName(unwrap(node.expression)) === 'raw') {
    return sqlText(node.arguments[0], declaration, identifier, bindings, seen);
  }
  return undefined;
}

function writesField(chain, field) {
  return chain.some((node) => {
    if (!ts.isCallExpression(node)) return false;
    const method = expressionName(unwrap(node.expression));
    if (!mutationMethods.has(method)) return false;
    if (method === 'select') return true;
    let value = unwrap(node.arguments[0]);
    if (!value) return false;
    if (method === 'onConflictDoUpdate' && ts.isObjectLiteralExpression(value)) {
      const update = value.properties.find((property) => nameOf(property) === 'set');
      if (!update) return value.properties.some(ts.isSpreadAssignment);
      value = unwrap(update.initializer ?? update.name);
    }
    return (ts.isArrayLiteralExpression(value) ? value.elements : [value]).some((entry) => {
      const row = unwrap(entry);
      return (
        !ts.isObjectLiteralExpression(row) ||
        row.properties.some(
          (property) =>
            nameOf(property) === field ||
            ts.isSpreadAssignment(property) ||
            (property.name && ts.isComputedPropertyName(property.name)),
        )
      );
    });
  });
}

function nearbyLines(lines, index, column = 0) {
  const context = [];
  let depth = 0;
  const tokenPattern = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\/.*$|[()[\]]/g;
  for (let next = index; next < lines.length; next += 1) {
    const line = (next === index ? lines[next].slice(column) : lines[next]).trim();
    if (next > index && depth <= 0 && !line.startsWith('.')) break;
    context.push(line);
    for (const [token] of line.matchAll(tokenPattern)) {
      if (token === '(' || token === '[') depth += 1;
      if (token === ')' || token === ']') depth -= 1;
    }
  }
  return context.join('\n');
}

function relativeSourcePath(sources, path, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const target = posix.normalize(posix.join(posix.dirname(path), specifier));
  const typescript = target.replace(/\.([cm]?)js$/, '.$1ts');
  return [target, typescript, `${target}.ts`, `${target}.js`, `${target}/index.ts`].find((entry) =>
    sources.has(entry),
  );
}

export function forwardedSources(sources, analyses = analyzeSources(sources)) {
  const forwards = new Map();
  const raw = new Set();
  for (const [path, { modules }] of analyses) {
    const targets = [];
    for (const { specifier, reexport } of modules) {
      if (!reexport) continue;
      if (dependencyRules.some(([, pattern]) => pattern.test(specifier))) raw.add(path);
      const target = relativeSourcePath(sources, path, specifier);
      if (target !== undefined) targets.push(target);
    }
    if (targets.length > 0) forwards.set(path, targets);
  }
  let size = -1;
  while (size !== raw.size) {
    size = raw.size;
    for (const [path, targets] of forwards) {
      if (targets.some((target) => raw.has(target))) raw.add(path);
    }
  }
  return (path, specifier) => raw.has(relativeSourcePath(sources, path, specifier));
}

const cachedAccess = new Map();
const cachedTrees = new Map();
let parsedTree;

function memoizedFindings(cache, capacity, key, scan) {
  if (!cache.has(key)) {
    const findings = scan();
    for (const finding of findings) {
      if (finding.writer) Object.freeze(finding.writer);
      Object.freeze(finding);
    }
    if (cache.size >= capacity) cache.delete(cache.keys().next().value);
    cache.set(key, Object.freeze(findings));
  }
  return cache.get(key);
}

export function accessFindings(path, source, forwardsRaw) {
  const scan = () =>
    sourceFindings(path, source, analyzeSources(new Map([[path, source]])).get(path), forwardsRaw);
  return forwardsRaw
    ? scan()
    : memoizedFindings(cachedAccess, 64, `${path}\0${digest(source)}`, scan);
}

export function migrationWriterFindings(path, source, tables, replacementTables) {
  if (!tables && !defaultTables) analyzeSources(new Map([[schemaPath, schemaSource]]));
  const findings = [];
  recordSqlWriters(
    outputWriterRecorder(path, findings),
    source,
    tables ?? defaultTables,
    undefined,
    source,
    replacementTables,
  );
  return findings;
}

function outputWriterRecorder(path, results) {
  const ordinals = new Map();
  return (table, symbol, operation, content, hasColumn) => {
    if (!table) return;
    const ordinal = (ordinals.get(symbol) ?? 0) + 1;
    ordinals.set(symbol, ordinal);
    const hash = digest(content);
    for (const column of table.columns) {
      if (!hasColumn(column)) continue;
      const field = `${table.name}.${column.property}`;
      results.push({
        path,
        rule: 'persisted-output-write',
        location: `${symbol}:${field}`,
        field,
        writer: { path, symbol, operation, ordinal, hash },
      });
    }
  };
}

function recordSqlWriters(record, source, tables, location, context, replacementTables) {
  const writes = sqliteWrites(source, replacementTables);
  for (const { table, tableNames, columns, symbol, statement, resolved, replacesRow } of writes) {
    const wholeRow = replacesRow || !columns.size;
    const operation = `${symbol} (${wholeRow ? '*' : [...columns].join(', ')})`;
    for (const target of tables.values()) {
      const matches = table === '?' || tableNames.has(target.name.toLowerCase());
      if (
        !matches &&
        (resolved || !new RegExp(`(?:^|[^\\w$])${target.name}(?:$|[^\\w$])`, 'i').test(statement))
      )
        continue;
      if (!resolved || table === '?' || columns.has('?')) {
        throw new Error(`Unresolved SQL write to ${target.name}: ${statement}`);
      }
      record(
        target,
        location ?? symbol,
        operation,
        operationFingerprint(statement, context === undefined ? [] : [context]),
        ({ sql }) =>
          wholeRow || [...columns].some((column) => column?.toLowerCase() === sql.toLowerCase()),
      );
    }
  }
}

function sourceFindings(path, source, analysis, forwardsRaw = () => false, replacementTables) {
  const results = [];
  const fingerprint = (node, operations = [], content = node.getText()) =>
    operationFingerprint(content, operationContext(node), operations);
  const record = (rule, location, node, operations = [], content) => {
    const value =
      typeof node === 'string'
        ? operationFingerprint(node, [source])
        : fingerprint(node, operations, content);
    const finding = { path, rule, location, hash: digest(value) };
    results.push(finding);
    return finding;
  };
  if (extname(path) === '.sql') {
    for (const { name, definition } of sqlTriggers(source)) {
      record('historical-trigger', name, definition);
    }
  } else if (analysis) {
    const { file, calls, frames, modules, tables, handoffs } = analysis;
    for (const { node, location, networkOperations } of handoffs) {
      if (networkOperations.length) record('network-handoff', location, node, networkOperations);
    }
    const dependencies = new Set();
    for (const { node, specifier } of modules) {
      const declaration = node.getText().replace(/;$/, '');
      for (const [rule, pattern] of dependencyRules) {
        if (
          !pattern.test(specifier) &&
          !(
            rule === 'sql-dependency' &&
            ['apps/server/src/db/client', 'apps/server/src/db/schema'].includes(
              specifier.startsWith('.')
                ? posix.normalize(posix.join(posix.dirname(path), specifier)).replace(JS, '')
                : specifier,
            )
          )
        )
          continue;
        dependencies.add(rule);
        record(rule, specifier, node, [], declaration);
      }
      if (forwardsRaw(path, specifier))
        record('forwarded-raw-dependency', specifier, node, [], declaration);
    }
    const opened = new Set();
    const sqlChains = new Map();
    const sqlExpressions = [];
    const recordWriter = outputWriterRecorder(path, results);
    for (const {
      node,
      expression,
      root,
      location,
      isProcess,
      isFile,
      fileOperations,
      networkOperations,
      processOperations,
      credentialOperations,
      deliveryOperations,
      isSqliteOpen,
      mutation,
      rawSql,
      isDatabase,
      isSqlExpression,
      sqlBindings,
      opaqueSql,
      unresolvedDatabaseMethod,
      unresolvedLoader,
    } of calls) {
      if (unresolvedLoader) record('unresolved-loader', `${location}:computed-module`, node);
      const name = expressionName(expression);
      const member = propertyReceiver(expression);
      if (isSqliteOpen) record('sqlite-open', `${location}:${expressionLabel(expression)}`, node);
      if (isSqlExpression) sqlExpressions.push({ node, location });
      const sqlCall =
        isDatabase ||
        mutation ||
        (unresolvedDatabaseMethod &&
          (dependencies.has('sql-dependency') ||
            modules.some(({ specifier }) => forwardsRaw(path, specifier))) &&
          (rawSql !== undefined ||
            /(?:^|\.)(?:db|tx|sqlite)(?:\.|$)/i.test(expressionLabel(member))));
      if (sqlCall) {
        const chain = [...invocationChain(node)].at(-1);
        const content = fingerprint(chain);
        if (!sqlChains.has(chain)) sqlChains.set(chain, { location, context: [] });
        sqlChains.get(chain).context.push(...sqlBindings);
        if (opaqueSql) record('opaque-sql', location, chain);
        if (mutation) {
          const verb = expressionName(mutation.expression);
          const table = tables.get(mutation.tableSymbol);
          const replacesRow =
            name !== 'onConflictDoUpdate' && replacementTables?.has(table?.name.toLowerCase());
          recordWriter(
            table,
            location,
            `${verb}.${name}`,
            JSON.stringify([mutation.node.getText(), content]),
            ({ property }) => replacesRow || writesField([node], property),
          );
        }
        if (rawSql !== undefined) {
          recordSqlWriters(
            recordWriter,
            rawSql,
            tables,
            location,
            JSON.stringify([content, ...sqlBindings]),
            replacementTables,
          );
        }
      }
      if (isFile || (dependencies.has('file-dependency') && legacyFileEffect.test(name)))
        record('filesystem-invocation', `${location}:file-operation`, node, fileOperations);
      if (networkOperations?.length)
        record(
          'network-invocation',
          `${location}:${expressionLabel(expression)}`,
          node,
          networkOperations,
        );
      if (credentialOperations?.length)
        record(
          'credential-invocation',
          `${location}:${expressionLabel(expression)}`,
          node,
          credentialOperations,
        );
      if (deliveryOperations?.size) {
        const kinds = [...deliveryOperations].sort();
        const callee = ts.isCallExpression(expression)
          ? `${expressionLabel(unwrap(expression.expression))}()`
          : expressionLabel(expression);
        const finding = record('outbound-delivery', `${location}:${callee}`, node, kinds);
        Object.assign(finding, {
          line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          kinds,
        });
      }
      if (isProcess)
        record(
          'process-invocation',
          `${location}:${expressionLabel(expression)}`,
          node,
          processOperations,
        );
      if (!ts.isCallExpression(node)) continue;
      if (member && hubEffect.test(name)) record('hub-invocation', `${location}:publication`, node);
      if (scopeOpeners.has(name)) {
        if (opened.has(root)) record('nested-scope-opener', `${location}:${name}`, node);
        opened.add(root);
      }
    }
    for (const [chain, { location, context }] of sqlChains) {
      record('sql-invocation', `${location}:query-or-mutation`, chain, context);
    }
    for (const { node, location } of sqlExpressions) {
      let parent = node.parent;
      while (parent && !sqlChains.has(parent)) parent = parent.parent;
      if (!parent) record('sql-expression', location, node);
    }
    const lines = source.split('\n');
    let offset = 0;
    for (const [index, line] of lines.entries()) {
      const start = offset;
      offset += line.length + 1;
      if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;
      const context = nearbyLines(lines, index);
      for (const [operation, pattern] of operationRules) {
        const match = pattern.exec(context);
        if (!match || match.index >= line.trim().length) continue;
        const pos = start + line.length - line.trimStart().length + match.index;
        const symbol =
          frames
            .filter(({ node, start }) => start <= pos && pos < node.end)
            .map(({ name }) => name)
            .join('.') || '<module>';
        let site = file;
        const locate = (node) => {
          if (node.getStart() <= pos && pos < node.end) {
            site = node;
            node.forEachChild(locate);
          }
        };
        locate(file);
        record('classified-operation', `${symbol}:${operation}`, site, [], context);
      }
    }
  } else if (/\.(?:sh|py)$/.test(path)) {
    const lines = source.split('\n');
    for (const [index, line] of lines.entries()) {
      if (/^\s*#/.test(line)) continue;
      for (const [operation, pattern] of operationalRules) {
        if (!pattern.test(line)) continue;
        let content = line.trim();
        if (operation === 'sqlite-cli-open') {
          let next = index + 1;
          while (
            next < lines.length &&
            ((content.match(/(?<!\\)"/g)?.length ?? 0) % 2 || content.endsWith('\\'))
          ) {
            content += `\n${lines[next++].trim()}`;
          }
        }
        record('operational-access', operation, content);
      }
    }
    for (const [statement] of source.matchAll(
      /\b(?:(?:insert(?:\s+or\s+\w+)?|replace)\s+into|update(?:\s+or\s+\w+)?|delete\s+from)\s+deploy_lease\b(?:'[^']*'|[^;'"#])*;/gi,
    )) {
      record('operational-access', 'deploy-sql-write', statement);
    }
  }
  return results;
}

export function violationKeys(findings) {
  const counts = new Map();
  for (const { path, rule, location, hash } of findings) {
    if (rule === 'persisted-output-write') continue;
    const key = `${path} | ${rule} | ${location} | ${hash}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => `${key} | ${count}`).sort();
}

export function allowanceDiff(allowlist, actual) {
  const expected = new Set();
  const duplicates = [];
  for (const key of allowlist) {
    if (expected.has(key)) duplicates.push(key);
    expected.add(key);
  }
  const found = new Set(actual);
  return {
    duplicates,
    unexpected: actual.filter((key) => !expected.has(key)),
    stale: allowlist.filter((key) => !found.has(key)),
  };
}

export function sourceTreeFindings(sources, replacementTables) {
  const analyses = analyzeSources(sources);
  return scanAnalyzedSources(sources, analyses, replacementTables);
}

function scanAnalyzedSources(sources, analyses, replacementTables) {
  const forwardsRaw = forwardedSources(sources, analyses);
  return [...sources].flatMap(([path, source]) =>
    sourceFindings(path, source, analyses.get(path), forwardsRaw, replacementTables),
  );
}

export function inventoryFindings(root, overrides = new Map()) {
  const read = sourceReader(root);
  const paths = [
    ...new Set([...trackedPaths(root, [...PRODUCT_ROOTS, MIGRATION_ROOT]), ...overrides.keys()]),
  ].sort();
  const isMigration = (path) => path.startsWith(`${MIGRATION_ROOT}/`) && path.endsWith('.sql');
  const tree = paths
    .filter((path) => isProtectedSource(path) || isMigration(path))
    .map((path) => [path, overrides.get(path) ?? read(path)]);
  const entries = tree.map(([path, source]) => [path, digest(source)]);
  const key = digest(JSON.stringify(entries));
  return memoizedFindings(cachedTrees, 8, key, () => {
    const sources = new Map(tree.filter(([path]) => isProtectedSource(path)));
    const migrations = tree.filter(([path]) => isMigration(path));
    const replacementTables = sqliteReplacementTables(
      migrations.map(([, source]) => source).join('\n;\n'),
    );
    const sourceKey = digest(JSON.stringify(entries.filter(([path]) => isProtectedSource(path))));
    if (parsedTree?.key !== sourceKey)
      parsedTree = { key: sourceKey, analyses: analyzeSources(sources) };
    const { analyses } = parsedTree;
    const findings = scanAnalyzedSources(sources, analyses, replacementTables);
    const { tables } = analyses.get(schemaPath);
    for (const [path, source] of migrations) {
      findings.push(...migrationWriterFindings(path, source, tables, replacementTables));
    }
    return findings;
  });
}

export function enforceAllowlist(allowances, findings) {
  const diff = allowanceDiff(allowances, violationKeys(findings));
  const drift = Object.entries(diff).flatMap(([kind, rows]) =>
    rows.length === 0 ? [] : [`${kind} (${rows.length}):\n${rows.slice(0, 12).join('\n')}`],
  );
  if (drift.length > 0) throw new Error(`Team-scope source access changed\n${drift.join('\n\n')}`);
}

export function validateInventoryShape(inventory, findings) {
  const distinct = (rows) => new Set(rows.map(({ id }) => id)).size === rows.length;
  const fieldWriters = new Map();
  const writerKey = ({ path, symbol, operation, ordinal, hash }) =>
    JSON.stringify([path, symbol, operation, ordinal, hash]);
  for (const { rule, field, writer } of findings) {
    if (rule === 'opaque-sql') return false;
    if (rule !== 'persisted-output-write') continue;
    if (!fieldWriters.has(field)) fieldWriters.set(field, []);
    fieldWriters.get(field).push(writerKey(writer));
  }
  const hasAllOutputWriters = (outputs, persistedOutputs = {}) => {
    const expectedFields = [
      ...new Set(
        outputs.flatMap((output) =>
          [...output.matchAll(/\b([a-z][\w]*\.[a-zA-Z_$][\w$]*)\b/g)].map(([, field]) => field),
        ),
      ),
    ];
    return (
      expectedFields.length > 0 &&
      Object.keys(persistedOutputs).length === expectedFields.length &&
      expectedFields.every((field) => {
        const expected = fieldWriters.get(field);
        const writers = persistedOutputs[field];
        if (!Array.isArray(writers) || !expected?.length || writers.length !== expected.length)
          return false;
        const declared = new Set(writers.map(writerKey));
        return (
          declared.size === expected.length && expected.every((writer) => declared.delete(writer))
        );
      })
    );
  };
  return (
    isDeepStrictEqual(inventory.foreignKeys, expectedForeignKeys) &&
    distinct(inventory.exactParents) &&
    distinct(inventory.admission) &&
    distinct(inventory.files) &&
    distinct(inventory.lineage) &&
    distinct(inventory.lineageOperations) &&
    distinct(inventory.negativeControls) &&
    inventory.lineageOperations.every(
      ({
        family,
        scopeKey,
        writer,
        readers,
        inputs,
        outputs,
        persistedOutputs,
        historicalEnforcement,
        evidence,
        disposition,
      }) =>
        inventory.lineage.some(({ id }) => id === family) &&
        Array.isArray(scopeKey) &&
        scopeKey.length > 0 &&
        scopeKey.every((part) => typeof part === 'string' && part.trim().length > 0) &&
        writer.path &&
        writer.symbol &&
        readers.length > 0 &&
        readers.every(({ path, symbol }) => path && symbol) &&
        inputs.length > 0 &&
        outputs.length > 0 &&
        hasAllOutputWriters(outputs, persistedOutputs) &&
        historicalEnforcement &&
        evidence &&
        disposition,
    ) &&
    inventory.exactParents.every(
      ({ child, parent, variant, nullable, lifecycle, writers }) =>
        child.length > 1 &&
        child.length === parent.length &&
        typeof child[0] === 'string' &&
        IDENTIFIER.test(child[0]) &&
        child
          .slice(1)
          .every((part) =>
            typeof part === 'string'
              ? IDENTIFIER.test(part)
              : part !== null &&
                typeof part === 'object' &&
                !Array.isArray(part) &&
                typeof part.column === 'string' &&
                IDENTIFIER.test(part.column) &&
                typeof part.literal === 'string' &&
                part.literal.trim().length > 0,
          ) &&
        parent.every((name) => IDENTIFIER.test(name)) &&
        variant &&
        (nullable === undefined ||
          (nullable !== null &&
            child.slice(1).includes(nullable.column) &&
            typeof nullable.until === 'string' &&
            nullable.until.trim().length > 0)) &&
        lifecycle &&
        writers.length > 0,
    )
  );
}
