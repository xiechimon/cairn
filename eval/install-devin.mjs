#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MANIFEST_URL = 'https://static.devin.ai/cli/current/manifest.json';
const ARCHIVE_HOST = 'static.devin.ai';
const TARGETS = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux',
  'linux-x64': 'x86_64-unknown-linux',
};

const target = TARGETS[`${process.platform}-${process.arch}`];
if (target === undefined)
  throw new Error(`devin install: unsupported ${process.platform}-${process.arch}`);

const outDir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'eval-devin-'));
mkdirSync(outDir, { recursive: true });

const manifest = await (await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(30_000) })).json();
const entry = manifest?.platforms?.[target];
if (entry === undefined) throw new Error(`devin manifest has no archive for ${target}`);
const url = new URL(entry.url);
if (url.protocol !== 'https:' || url.hostname !== ARCHIVE_HOST)
  throw new Error(`devin archive host untrusted: ${entry.url}`);

const bytes = Buffer.from(
  await (await fetch(entry.url, { signal: AbortSignal.timeout(300_000) })).arrayBuffer(),
);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (typeof entry.sha256 !== 'string' || sha256 !== entry.sha256.toLowerCase())
  throw new Error('devin archive checksum missing or mismatched');

const staging = mkdtempSync(join(tmpdir(), 'eval-devin-x-'));
const tarball = join(staging, 'devin.tar.gz');
writeFileSync(tarball, bytes);
execFileSync('tar', ['-xzf', tarball, '-C', staging]);
rmSync(tarball);

const tops = readdirSync(staging).filter((e) => statSync(join(staging, e)).isDirectory());
const root = tops.length === 1 ? join(staging, tops[0]) : staging;
const src = join(root, 'bin', 'devin');
if (!existsSync(src)) throw new Error('devin archive has no bin/devin');
const binDir = join(outDir, 'bin');
mkdirSync(binDir, { recursive: true });
const dest = join(binDir, 'devin');
execFileSync('cp', [src, dest]);
chmodSync(dest, 0o755);
rmSync(staging, { recursive: true, force: true });
console.log(`devin ${manifest.version} -> ${dest}`);
