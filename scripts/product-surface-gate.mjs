#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const REGISTRY_PATH = join(REPO_ROOT, 'scripts/product-surface-registry.json');
const REGISTRY_REL = 'scripts/product-surface-registry.json';

const SCAN_ROOTS = [
  'apps/server/src',
  'apps/daemon/src',
  'apps/desktop/src',
  'apps/web/src',
  'packages/shared/src',
  'scripts',
  'integration',
];
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]s|tsx|sh)$/;
const EXCLUDED_PATH =
  /(?:^|\/)(?:test|tests|fixtures|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;
const CAIRN_ENV_PATTERN = 'CAIRN_[A-Z0-9_]+';
const STRING_ENV = /(["'`])(CAIRN_[A-Z0-9_]+)\1/g;
const ACCESS_ENV = /(?:process\.env|\benv)\.(CAIRN_[A-Z0-9_]+)\b/g;
const OBJECT_KEY_ENV = /(?<![\w$])(CAIRN_[A-Z0-9_]+)\s*:/g;
const DESTRUCTURED_ENV =
  /(?:const|let|var)\s*\{[^}]*?\b(CAIRN_[A-Z0-9_]+)\b[^}]*\}\s*=\s*(?:process\.env|\benv\b)/g;
const SHELL_ENV = /(?<![\w$])(CAIRN_[A-Z0-9_]+)\b/g;

const PROMPT_FILES = [
  'apps/server/src/services/action-proposals.ts',
  'apps/server/src/services/chief.ts',
  'apps/server/src/services/ci-fix-prompts.ts',
  'apps/server/src/services/im/core.ts',
  'apps/server/src/services/mail.ts',
  'apps/server/src/services/memory-edit.ts',
  'apps/daemon/src/step-prompt.ts',
  'packages/shared/src/records/prompts.ts',
  'packages/shared/src/records/research-prompts.ts',
];

const rel = (path) => relative(REPO_ROOT, path).split(sep).join('/');

const fatal = (message) => {
  console.error(`[product-surface-gate] FATAL: ${message}`);
  process.exit(2);
};

function runGit(args, { allowMissing = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fatal(result.error.message);
  if (result.status !== 0) {
    if (allowMissing) return null;
    fatal(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function inScope(path) {
  return (
    SCAN_ROOTS.some((root) => path === root || path.startsWith(`${root}/`)) &&
    SOURCE_EXTENSION.test(path) &&
    !EXCLUDED_PATH.test(path)
  );
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'build'].includes(entry.name)) walk(path, out);
    } else if (inScope(rel(path))) {
      out.push(path);
    }
  }
  return out;
}

function extractEnvKeysFromLine(line, out, { shell = false } = {}) {
  for (const pattern of [STRING_ENV, ACCESS_ENV, OBJECT_KEY_ENV, DESTRUCTURED_ENV]) {
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern)) out.add(match[2] ?? match[1]);
  }
  if (shell) {
    SHELL_ENV.lastIndex = 0;
    for (const match of line.matchAll(SHELL_ENV)) out.add(match[1]);
  }
}

function currentEnvSurface() {
  const keys = new Map();
  const files = SCAN_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)));
  for (const path of files) {
    const found = new Set();
    const shell = path.endsWith('.sh');
    for (const line of readFileSync(path, 'utf8').split('\n'))
      extractEnvKeysFromLine(line, found, { shell });
    for (const key of found) {
      const paths = keys.get(key) ?? new Set();
      paths.add(rel(path));
      keys.set(key, paths);
    }
  }
  return { keys, fileCount: files.length };
}

function baseEnvSurface(base) {
  const text = runGit(['grep', '-n', '-E', CAIRN_ENV_PATTERN, base, '--', ...SCAN_ROOTS], {
    allowMissing: true,
  });
  const keys = new Set();
  if (text === null) return keys;
  for (const row of text.split('\n')) {
    if (row === '') continue;
    const first = row.indexOf(':');
    const second = row.indexOf(':', first + 1);
    const third = row.indexOf(':', second + 1);
    if (first < 0 || second < 0 || third < 0) continue;
    const path = row.slice(first + 1, second);
    if (!inScope(path)) continue;
    extractEnvKeysFromLine(row.slice(third + 1), keys, { shell: path.endsWith('.sh') });
  }
  return keys;
}

function skipQuoted(source, index) {
  const quote = source[index];
  for (let i = index + 1; i < source.length; i++) {
    if (source[i] === '\\') i++;
    else if (source[i] === quote) return i + 1;
  }
  return source.length;
}

function balancedEnd(source, openAt) {
  let depth = 0;
  for (let i = openAt; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"' || char === "'" || char === '`') {
      i = skipQuoted(source, i) - 1;
      continue;
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

function statementEnd(source, start) {
  let round = 0;
  let curly = 0;
  let square = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"' || char === "'" || char === '`') {
      i = skipQuoted(source, i) - 1;
      continue;
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === '(') round++;
    else if (char === ')') round--;
    else if (char === '{') curly++;
    else if (char === '}') curly--;
    else if (char === '[') square++;
    else if (char === ']') square--;
    else if (char === ';' && round === 0 && curly === 0 && square === 0) return i + 1;
  }
  return source.length;
}

const DECLARATION = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/g;
const OBJECT_START = /(?:z\.object|z\.strictObject|\.object|\.strictObject|\.extend)\s*\(\s*\{/g;
const OBJECT_KEY = /(?<![\w$])["']?([A-Za-z_$][\w$]*)["']?\s*:/g;

function valueEnd(source, start) {
  let round = 0;
  let curly = 0;
  let square = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"' || char === "'" || char === '`') {
      i = skipQuoted(source, i) - 1;
      continue;
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === '(') round++;
    else if (char === ')') round--;
    else if (char === '{') curly++;
    else if (char === '}') {
      if (curly === 0 && round === 0 && square === 0) return i;
      curly--;
    } else if (char === '[') square++;
    else if (char === ']') square--;
    else if (char === ',' && curly === 0 && round === 0 && square === 0) return i;
  }
  return source.length;
}

function objectEntries(objectText) {
  const entries = [];
  let depth = 0;
  for (let i = 0; i < objectText.length; i++) {
    const char = objectText[i];
    const next = objectText[i + 1];
    if (char === '/' && next === '/') {
      const end = objectText.indexOf('\n', i + 2);
      i = end < 0 ? objectText.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = objectText.indexOf('*/', i + 2);
      i = end < 0 ? objectText.length : end + 1;
      continue;
    }
    if (char === '{') {
      depth++;
      continue;
    }
    if (char === '}') {
      depth--;
      continue;
    }
    if (depth !== 1) {
      if (char === '"' || char === "'" || char === '`') i = skipQuoted(objectText, i) - 1;
      continue;
    }

    let key = null;
    let end = i;
    if (char === '"' || char === "'") {
      end = skipQuoted(objectText, i);
      let colon = end;
      while (/\s/.test(objectText[colon] ?? '')) colon++;
      if (objectText[colon] !== ':') {
        i = end - 1;
        continue;
      }
      key = objectText.slice(i + 1, end - 1);
    } else if (/[A-Za-z_$]/.test(char)) {
      end = i + 1;
      while (end < objectText.length && /[\w$]/.test(objectText[end])) end++;
      key = objectText.slice(i, end);
    } else {
      if (char === '`') i = skipQuoted(objectText, i) - 1;
      continue;
    }

    let colon = end;
    while (/\s/.test(objectText[colon] ?? '')) colon++;
    if (objectText[colon] !== ':' || !/^[A-Za-z_$][\w$]*$/.test(key)) {
      i = end;
      continue;
    }
    let start = colon + 1;
    while (/\s/.test(objectText[start] ?? '')) start++;
    const valueFinish = valueEnd(objectText, start);
    entries.push({ key, valueStart: start, valueEnd: valueFinish });
    i = valueFinish;
  }
  return entries;
}

function schemaObjectRanges(segment) {
  const objects = [];
  for (const objectStart of segment.matchAll(OBJECT_START)) {
    const openAt = objectStart.index + objectStart[0].length - 1;
    const end = balancedEnd(segment, openAt);
    if (end !== null) objects.push({ openAt, end });
  }
  return objects.filter(
    (object) =>
      !objects.some(
        (other) => other !== object && other.openAt < object.openAt && object.openAt < other.end,
      ),
  );
}

function collectObjectKeys(objectText, prefix, keys) {
  for (const entry of objectEntries(objectText)) {
    const path = `${prefix}${entry.key}`;
    keys.add(path);
    const value = objectText.slice(entry.valueStart, entry.valueEnd);
    for (const object of schemaObjectRanges(value)) {
      collectObjectKeys(value.slice(object.openAt, object.end), `${path}.`, keys);
    }
  }
}

function schemaKeys(source, wanted) {
  const result = new Map();
  for (const declaration of source.matchAll(DECLARATION)) {
    const name = declaration[1];
    if (!wanted(name)) continue;
    const start = declaration.index + declaration[0].length;
    const segment = source.slice(start, statementEnd(source, start));
    const keys = new Set();
    for (const object of schemaObjectRanges(segment)) {
      collectObjectKeys(segment.slice(object.openAt, object.end), '', keys);
    }
    result.set(name, keys);
  }
  return result;
}

function gitShow(base, path) {
  return runGit(['show', `${base}:${path}`], { allowMissing: true });
}

function listRecordFiles(base) {
  const current = existsSync(join(REPO_ROOT, 'packages/shared/src/records'))
    ? readdirSync(join(REPO_ROOT, 'packages/shared/src/records'))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => `packages/shared/src/records/${name}`)
    : [];
  const atBase = (
    runGit(['ls-tree', '-r', '--name-only', base, '--', 'packages/shared/src/records']) ?? ''
  )
    .split('\n')
    .filter((line) => line.endsWith('.ts'));
  return [...new Set([...current, ...atBase])].sort();
}

const SETTINGS_SCHEMA = /(?:BodySchema|InputSchema|SettingsSchema)$/;

function settingsSurface(base) {
  const read = (path) =>
    base === null ? readFileSync(join(REPO_ROOT, path), 'utf8') : gitShow(base, path);
  const surface = new Map();
  for (const path of listRecordFiles(base ?? 'HEAD')) {
    if (path.endsWith('/machine.ts')) continue;
    if (base === null && !existsSync(join(REPO_ROOT, path))) continue;
    const source = read(path);
    if (source === null) continue;
    for (const [schema, keys] of schemaKeys(source, (name) => SETTINGS_SCHEMA.test(name))) {
      for (const key of keys) surface.set(`${schema}.${key}`, { schema, key, path });
    }
  }
  return surface;
}

const DEVICE_SOURCES = [
  {
    surface: 'machine',
    files: ['packages/shared/src/records/machine.ts'],
    schemas: ['machineRecordSchema', 'patchMachineBodySchema'],
    tables: ['machine'],
  },
  {
    surface: 'pairedDevice',
    files: ['packages/shared/src/remote-access.ts'],
    schemas: ['pairedDeviceSchema'],
    tables: ['paired_device'],
  },
  {
    surface: 'computer',
    files: ['packages/shared/src/protocol/computer.ts'],
    schemas: ['computerRecordSchema'],
    tables: ['computer'],
  },
  { surface: 'phone', files: [], schemas: [], tables: ['phone'] },
];

function tableKeys(source, table) {
  const pattern = new RegExp(`sqliteTable\\(\\s*['"]${table}['"]\\s*,\\s*\\{`);
  const match = pattern.exec(source);
  if (match === null) return new Set();
  const openAt = match.index + match[0].length - 1;
  const end = balancedEnd(source, openAt);
  if (end === null) return new Set();
  const keys = new Set();
  for (const key of source.slice(openAt, end).matchAll(OBJECT_KEY)) keys.add(key[1]);
  return keys;
}

function deviceSurface(base) {
  const surface = new Map();
  const read = (path) =>
    base === null
      ? existsSync(join(REPO_ROOT, path))
        ? readFileSync(join(REPO_ROOT, path), 'utf8')
        : null
      : gitShow(base, path);
  for (const sourceDef of DEVICE_SOURCES) {
    const keys = new Set();
    for (const path of sourceDef.files) {
      const source = read(path);
      if (source === null) continue;
      const wanted = new Set(sourceDef.schemas);
      for (const schema of schemaKeys(source, (name) => wanted.has(name)).values()) {
        for (const key of schema) keys.add(key);
      }
    }
    const schemaSource = read('apps/server/src/db/schema.ts');
    if (schemaSource !== null) {
      for (const table of sourceDef.tables) {
        for (const key of tableKeys(schemaSource, table)) keys.add(key);
      }
    }
    for (const key of keys)
      surface.set(`${sourceDef.surface}.${key}`, { surface: sourceDef.surface, key });
  }
  return surface;
}

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) fatal(`${REGISTRY_REL} is missing`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (error) {
    fatal(`${REGISTRY_REL} is not valid JSON: ${error.message}`);
  }
  const rows = parsed?.surfaces;
  if (!Array.isArray(rows)) fatal(`${REGISTRY_REL}: surfaces must be an array`);
  const seen = new Set();
  const problems = [];
  for (const row of rows) {
    const label = `${row?.type ?? '?'} ${row?.key ?? '?'}`;
    if (!['env', 'setting', 'runner-device-field'].includes(row?.type)) {
      problems.push(`${label}: type must be env, setting or runner-device-field`);
      continue;
    }
    if (typeof row.key !== 'string' || row.key === '') problems.push(`${label}: key is required`);
    if (row.type === 'env' && !/^CAIRN_[A-Z0-9_]+$/.test(row.key))
      problems.push(`${label}: env keys must match CAIRN_[A-Z0-9_]+`);
    if (row.type === 'env' && !['product', 'dev-tooling'].includes(row.scope))
      problems.push(`${label}: env scope must be product or dev-tooling`);
    if (typeof row.userScenario !== 'string' || row.userScenario.trim().length < 12)
      problems.push(
        `${label}: userScenario must be one non-empty line naming where a new user meets it`,
      );
    else if (row.userScenario !== row.userScenario.trim() || /[\r\n]/.test(row.userScenario))
      problems.push(`${label}: userScenario must be one trimmed line`);
    const id = `${row.type}\0${row.key}`;
    if (seen.has(id)) problems.push(`${label}: duplicate registry row`);
    seen.add(id);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[product-surface-gate] ${problem}`);
    process.exit(2);
  }
  return rows;
}

function registered(rows, type, key) {
  return rows.some((row) => row.type === type && row.key === key);
}

function mergeBase() {
  const explicit = process.env.PRODUCT_SURFACE_BASE_SHA || process.env.PREPUSH_BASE_SHA || '';
  if (explicit !== '' && !/^0+$/.test(explicit)) return explicit;
  const origin = runGit(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], {
    allowMissing: true,
  });
  if (origin === null) return '';
  return (
    runGit(['merge-base', 'HEAD', 'refs/remotes/origin/main'], { allowMissing: true }) ?? ''
  ).trim();
}

function objectSizeAtBase(base, path) {
  const result = spawnSync('git', ['cat-file', '-s', `${base}:${path}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) return 0;
  return Number(result.stdout.trim()) || 0;
}

function promptGrowth(base) {
  const grown = [];
  for (const path of PROMPT_FILES) {
    const before = objectSizeAtBase(base, path);
    const now = existsSync(join(REPO_ROOT, path)) ? statSync(join(REPO_ROOT, path)).size : 0;
    if (now > before) grown.push({ path, before, now });
  }
  if (grown.length === 0) return [];
  const messages =
    runGit(['log', '--format=%B%x00', `${base}..HEAD`], { allowMissing: true }) ?? '';
  if (/^Prompt-growth:\s*\S+/m.test(messages)) return [];
  return grown;
}

function main() {
  const argv = process.argv.slice(2);
  let base = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') {
      base = argv[++i] ?? '';
      if (base === '') fatal('--base requires a sha argument');
    } else {
      fatal(`unknown argument: ${argv[i]} (expected --base <sha>)`);
    }
  }
  if (base === '') base = mergeBase();
  const rows = loadRegistry();
  if (base === '') {
    fatal('no merge-base is available; pass --base <sha> or fetch refs/remotes/origin/main');
  }
  if (
    runGit(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { allowMissing: true }) ===
    null
  ) {
    fatal(`base ${base} is not available locally; fetch it first`);
  }

  const failures = [];
  const currentEnv = currentEnvSurface();
  const baseEnv = baseEnvSurface(base);
  for (const [key, paths] of currentEnv.keys) {
    if (!baseEnv.has(key) && !registered(rows, 'env', key)) {
      failures.push(
        `env ${key}: new CAIRN_* environment variable without a registry row (${[...paths].sort().join(', ')})`,
      );
    }
  }

  const baseSettings = settingsSurface(base);
  const currentSettings = settingsSurface(null);
  for (const [surface, detail] of currentSettings) {
    if (!baseSettings.has(surface) && !registered(rows, 'setting', surface)) {
      failures.push(
        `setting ${surface}: new user-writable settings key without a registry row (${detail.path})`,
      );
    }
  }

  const baseDevices = deviceSurface(base);
  const currentDevices = deviceSurface(null);
  for (const surface of currentDevices.keys()) {
    if (!baseDevices.has(surface) && !registered(rows, 'runner-device-field', surface)) {
      failures.push(
        `runner-device-field ${surface}: new runner/device field without a registry row`,
      );
    }
  }

  for (const growth of promptGrowth(base)) {
    failures.push(
      `prompt ${growth.path}: prompt file grew ${growth.before} -> ${growth.now} bytes without a Prompt-growth: <reason> commit trailer`,
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) console.log(`[product-surface-gate] ${failure}`);
    console.log(
      `[product-surface-gate] FAIL: ${failures.length} product-surface violation(s). Register env/settings/runner-device rows in ${REGISTRY_REL} with one user scenario line, or explain prompt growth in a Prompt-growth: trailer.`,
    );
    process.exit(1);
  }

  console.log(
    `[product-surface-gate] PASS: ${currentEnv.keys.size} env name(s), ${currentSettings.size} settings key(s), ${currentDevices.size} runner/device field(s), ${PROMPT_FILES.length} prompt file(s) compared with ${base.slice(0, 12)} across ${currentEnv.fileCount} scanned source file(s).`,
  );
}

main();
