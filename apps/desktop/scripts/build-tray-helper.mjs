import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const TRAY_HELPER_MIN_MACOS = '12.0';
export const TRAY_HELPER_ARCHES = { arm64: 'arm64', x64: 'x86_64' };
export const TRAY_HELPER_ICONS = [
  'trayTemplate.png',
  'trayTemplate@2x.png',
  'trayAwakeTemplate.png',
  'trayAwakeTemplate@2x.png',
];

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(desktopDir, 'native', 'tray');

export function trayHelperSources(extra = 'app') {
  const files = (dir) =>
    readdirSync(join(sourceDir, dir))
      .filter((name) => name.endsWith('.swift'))
      .sort()
      .map((name) => join(sourceDir, dir, name));
  return [...files('core'), ...files(extra)];
}

export async function compileTrayHelper(
  output,
  { arch = process.arch, extra = 'app', optimize = true } = {},
) {
  const triple = TRAY_HELPER_ARCHES[arch];
  if (triple === undefined) throw new Error(`no tray helper target for ${arch}`);
  mkdirSync(dirname(output), { recursive: true });
  const partial = `${output}.${process.pid}`;
  await promisify(execFile)(
    'xcrun',
    [
      'swiftc',
      '-swift-version',
      '5',
      optimize ? '-O' : '-Onone',
      '-target',
      `${triple}-apple-macos${TRAY_HELPER_MIN_MACOS}`,
      ...trayHelperSources(extra),
      '-o',
      partial,
    ],
    { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
  );
  renameSync(partial, output);
  return output;
}

export async function buildTrayHelpers(root = join(desktopDir, 'tray-helper')) {
  rmSync(root, { recursive: true, force: true });
  await Promise.all(
    Object.keys(TRAY_HELPER_ARCHES).map(async (arch) => {
      const dir = join(root, arch);
      await compileTrayHelper(join(dir, 'CairnTray'), { arch });
      for (const icon of TRAY_HELPER_ICONS) {
        copyFileSync(join(desktopDir, 'assets', icon), join(dir, icon));
      }
    }),
  );
  return root;
}
