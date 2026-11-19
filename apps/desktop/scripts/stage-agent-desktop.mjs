import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.3.1';
const BASE = `https://github.com/vercel-labs/agent-desktop/releases/download/v${VERSION}`;
const LICENSE = {
  url: `https://raw.githubusercontent.com/vercel-labs/agent-desktop/v${VERSION}/LICENSE`,
  sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
};
const RELEASES = {
  arm64: {
    url: `${BASE}/agent-desktop-v${VERSION}-aarch64-apple-darwin.tar.gz`,
    sha256: '9b7b7cfc74892eab46c2c85d6cb7dc4863bf8dab0a222cfcfb8ae4604c69c86c',
  },
  x64: {
    url: `${BASE}/agent-desktop-v${VERSION}-x86_64-apple-darwin.tar.gz`,
    sha256: '469da10cfb68928c58caff88b92b30526e0ca895ac06bc86b7f533b1d9b309b3',
  },
};
const FILES = ['agent-desktop', 'agent-desktop-macos-helper'];

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktopDir, 'agent-desktop');

async function pinned({ url, sha256 }) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== sha256) throw new Error(`${url} has sha256 ${digest}, expected ${sha256}`);
  return bytes;
}

const license = await pinned(LICENSE);
rmSync(root, { recursive: true, force: true });
for (const [arch, release] of Object.entries(RELEASES)) {
  const scratch = mkdtempSync(join(tmpdir(), 'agent-desktop-'));
  try {
    const archive = join(scratch, 'archive.tar.gz');
    writeFileSync(archive, await pinned(release));
    const unpacked = join(scratch, 'unpacked');
    mkdirSync(unpacked);
    execFileSync('tar', ['-xzf', archive, '-C', unpacked]);
    const found = readdirSync(unpacked).sort();
    if (found.join(',') !== FILES.join(','))
      throw new Error(`${release.url} holds ${found.join(', ')}, expected ${FILES.join(', ')}`);
    const target = join(root, arch);
    mkdirSync(target, { recursive: true });
    for (const name of FILES) {
      copyFileSync(join(unpacked, name), join(target, name));
      chmodSync(join(target, name), 0o755);
    }
    writeFileSync(join(target, 'LICENSE'), license);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(`staged agent-desktop ${VERSION} for ${Object.keys(RELEASES).join(', ')} into ${root}`);
