import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants as fsConstants, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
];

function isExecutableFile(candidate) {
  try {
    accessSync(candidate, fsConstants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function resolveDevinBin(env = process.env) {
  const override = env.EVAL_DEVIN_BIN?.trim();
  if (override) return override;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'devin');
    if (isExecutableFile(candidate)) return candidate;
  }
  const realHome = env.HOME || homedir();
  const toolRoot = join(realHome, '.cairn', 'tools', 'devin');
  try {
    const current = JSON.parse(readFileSync(join(toolRoot, 'current.json'), 'utf8'));
    if (typeof current?.version === 'string' && current.version.trim() !== '') {
      const managed = join(toolRoot, 'versions', current.version.trim(), 'bin', 'devin');
      if (isExecutableFile(managed)) return managed;
    }
  } catch {}
  return 'devin';
}

export function laneEnv(env = process.env) {
  const keep = new Set(LANE_ENV_KEYS);
  const filtered = Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => value !== undefined && (keep.has(key) || key.startsWith('DEVIN_')),
    ),
  );
  const isolatedHome = env.EVAL_DAILY_DEVIN_HOME?.trim();
  if (isolatedHome) filtered.HOME = isolatedHome;
  filtered.PYTHONDONTWRITEBYTECODE = '1';
  return filtered;
}

export function scrubDiagnostics(raw, extraPaths = []) {
  let text = String(raw ?? '').trim();
  if (!text) return '';
  for (const pathValue of extraPaths) {
    if (typeof pathValue === 'string' && pathValue.trim() !== '') {
      text = text.split(pathValue).join('<HOME>');
    }
  }
  text = text
    .replace(/\b(?:sk-lf|pk-lf)-[A-Za-z0-9_-]{6,}/g, '<REDACTED>')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '<REDACTED>')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._+/=-]{6,}/gi, '$1 <REDACTED>')
    .replace(/\b((?:DEVIN|LANGFUSE)_[A-Z0-9_]*)=([^\s'"]+)/g, '$1=<REDACTED>')
    .replace(/\/Users\/[^/\s'"]+/g, '/Users/<HOME>')
    .replace(/\/home\/[^/\s'"]+/g, '/home/<HOME>');
  return text.length > 1200 ? `${text.slice(0, 1185)}...[truncated]` : text;
}

export function checkDevinAuth({ env = process.env, timeoutMs = 15_000 } = {}) {
  const bin = resolveDevinBin(env);
  const childEnv = laneEnv(env);
  const extraPaths = [env.HOME, env.EVAL_DAILY_DEVIN_HOME].filter(Boolean);
  const res = spawnSync(bin, ['auth', 'status'], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: childEnv,
  });
  const ok = res.error === undefined && res.status === 0;
  const rawDetail = res.error
    ? res.error.message
    : [res.stderr, res.stdout].filter(Boolean).join('\n');
  return {
    ok,
    bin,
    exitCode: res.status ?? 1,
    detail: scrubDiagnostics(rawDetail, extraPaths),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check-auth')) {
    const result = checkDevinAuth();
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  }
  if (process.argv.includes('--version')) {
    const bin = resolveDevinBin();
    try {
      const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 5_000 });
      console.log(out.trim());
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
}
