import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.41.2';
const BASE = `https://github.com/vercel-labs/agent-browser/releases/download/v${VERSION}`;
const LICENSE = {
  url: `https://raw.githubusercontent.com/vercel-labs/agent-browser/v${VERSION}/LICENSE`,
  sha256: '014bb31e83d5c2e76aea1cc6e82217346ab41362f32cb355ad0f5c10aa0aeaff',
};
const RELEASES = {
  arm64: {
    url: `${BASE}/agent-browser-darwin-arm64`,
    sha256: '19680f06cf87d0095c318a2e80bea6b71523d95d3b651cd18d81885cd182477a',
  },
  x64: {
    url: `${BASE}/agent-browser-darwin-x64`,
    sha256: 'fc55608c2222650e6e0d0154f9edebd203b63bf853b85d22240bfbddbb006ea1',
  },
};

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktopDir, 'agent-browser');

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
  const binary = await pinned(release);
  const target = join(root, arch);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'agent-browser'), binary);
  chmodSync(join(target, 'agent-browser'), 0o755);
  writeFileSync(join(target, 'LICENSE'), license);
}

console.log(`staged agent-browser ${VERSION} for ${Object.keys(RELEASES).join(', ')} into ${root}`);
