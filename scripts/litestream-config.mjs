import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function hasControlChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function hasControlOrWhitespace(value) {
  return /\s/.test(value) || hasControlChars(value);
}

function parseBucket(raw) {
  const bucket = (raw ?? '').trim();
  if (
    bucket === '' ||
    hasControlOrWhitespace(bucket) ||
    bucket.includes('/') ||
    bucket.includes('..')
  ) {
    throw new Error('CAIRN_LITESTREAM_BUCKET must be a valid non-empty bucket name');
  }
  return bucket;
}

function parseReplicaPath(raw) {
  const path = (raw ?? '').trim();
  if (path === '') return 'server.db';
  if (path.startsWith('/') || path.includes('\\') || hasControlChars(path)) {
    throw new Error('CAIRN_LITESTREAM_PATH must be a relative key path without control characters');
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('CAIRN_LITESTREAM_PATH must not contain empty, ".", or ".." segments');
  }
  return path;
}

function parseEndpoint(raw) {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  if (hasControlChars(trimmed)) {
    throw new Error('CAIRN_LITESTREAM_ENDPOINT must not contain control characters');
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('CAIRN_LITESTREAM_ENDPOINT must be a valid http(s) URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('CAIRN_LITESTREAM_ENDPOINT must use http or https');
  }
  if (parsed.hostname === '' || parsed.username !== '' || parsed.password !== '') {
    throw new Error('CAIRN_LITESTREAM_ENDPOINT must include a hostname without credentials');
  }
  return trimmed.replace(/\/+$/, '');
}

function parseRegion(raw, hasEndpoint) {
  const region = (raw ?? '').trim();
  if (region === '') return hasEndpoint ? 'auto' : null;
  if (hasControlOrWhitespace(region)) {
    throw new Error('CAIRN_LITESTREAM_REGION must not contain whitespace or control characters');
  }
  return region;
}

export function buildLitestreamConfig({ dbPath, env = process.env }) {
  if (typeof dbPath !== 'string' || dbPath.trim() === '' || hasControlChars(dbPath)) {
    throw new Error('Litestream database path must be a non-empty path without control characters');
  }
  const bucket = parseBucket(env.CAIRN_LITESTREAM_BUCKET);
  const path = parseReplicaPath(env.CAIRN_LITESTREAM_PATH);
  const endpoint = parseEndpoint(env.CAIRN_LITESTREAM_ENDPOINT);
  const region = parseRegion(env.CAIRN_LITESTREAM_REGION, endpoint !== null);

  const lines = [
    'dbs:',
    `  - path: ${JSON.stringify(dbPath.trim())}`,
    '    replica:',
    '      type: "s3"',
    `      bucket: ${JSON.stringify(bucket)}`,
    `      path: ${JSON.stringify(path)}`,
  ];
  if (endpoint !== null) {
    lines.push(`      endpoint: ${JSON.stringify(endpoint)}`);
    lines.push('      force-path-style: true');
  }
  if (region !== null) {
    lines.push(`      region: ${JSON.stringify(region)}`);
  }
  return `${lines.join('\n')}\n`;
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const [dbPath, outPath] = process.argv.slice(2);
  if (!dbPath || !outPath) {
    process.stderr.write('usage: litestream-config.mjs <dbPath> <outPath>\n');
    process.exit(1);
  }
  try {
    const yaml = buildLitestreamConfig({ dbPath, env: process.env });
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, yaml, { mode: 0o600 });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
