#!/usr/bin/env node
// cli 包 pack 冒烟（06 册 §11 W2，#270；与主包冒烟 #264 同族）：pnpm pack →
// 仓外临时目录 npm install tarball → 裸 node 跑 bin 断言。失败方式枚举（写码
// 前固化，断言逐条对应）：
// ① CJS 依赖 __require 桩炸（pino 顶层 require，ESM 无 require）→ --help 非 0
// ② dist 未进 tarball（files 缺失 / .gitignore 回退排除）→ bin 缺失
// ③ workspace:* 残留 dependencies → pnpm pack 炸
// ④ bin 路径断 → npm install 链接失败
// ⑤ externals 漏声明（pi 系）→ 裸跑 ERR_MODULE_NOT_FOUND
// ⑥ --version 与 package.json 漂移
// ⑦ 安装目录在仓内 → npm 爬仓根 catalog: 炸 EUNSUPPORTEDPROTOCOL——安装目录
//   必须 mktemp 在 os.tmpdir()（仓外），pack 目录同理
//
// 运行：pnpm --filter @xiechimon/cairn-cli smoke（依赖面走公网 registry）

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTERNALS } from '../externals.mjs';

const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
const BIN_NAME = Object.keys(pkg.bin)[0];
const BIN_PATH = pkg.bin[BIN_NAME]; // "./dist/cli.mjs"
const TARBALL_NAME = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;

/** 冒烟断言失败（已打点，退出码已置 1）；脚本自身 bug 用原生 Error 冒泡。 */
class SmokeStepError extends Error {}

function run(cmd, args, opts) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

/** 失败详情通用格式（step 的 detail 参数：状态码 + 两路输出）。 */
function fmt(r) {
  return `${r.status}\n${r.stdout}\n${r.stderr}`;
}

function step(name, ok, detail) {
  if (!ok) {
    console.error(`smoke: FAIL ${name}`);
    if (detail) console.error(detail);
    process.exitCode = 1;
    throw new SmokeStepError(name);
  }
  console.log(`smoke: ok ${name}`);
}

/** engines 预检：`>=22.19.0` 形（仓内约定无通配），低版本裸跑只会更糊涂。 */
function nodeTooOld() {
  const min = pkg.engines.node.replace(/^>=/, '').split('.').map(Number);
  const now = process.versions.node.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((now[i] ?? 0) !== (min[i] ?? 0)) return (now[i] ?? 0) < (min[i] ?? 0);
  }
  return false;
}

const packDir = mkdtempSync(join(tmpdir(), 'cairn-cli-pack-'));
const installDir = mkdtempSync(join(tmpdir(), 'cairn-cli-smoke-')); // 仓外（⑦）
try {
  step(`node engines ${pkg.engines.node}`, !nodeTooOld());

  // pnpm pack（prepack 触发 esbuild bundle；仓内 cwd 走 repo 的 pnpm，无 corepack 闸）
  const packed = run('pnpm', ['pack', '--pack-destination', packDir], { cwd: PKG_DIR });
  step('pnpm pack（workspace:* 已出 dependencies）', packed.status === 0, fmt(packed));
  const tarball = join(packDir, TARBALL_NAME);

  // tarball 内容面：bin 在包内（②），src/test 不进包（files:["dist"] 形状）
  const listed = run('tar', ['-tzf', tarball]);
  step('tar -tzf', listed.status === 0, fmt(listed));
  const entries = listed.stdout.split('\n').filter(Boolean);
  step(
    'tarball 含 bin 产物',
    entries.includes(`package/${BIN_PATH.replace('./', '')}`),
    entries.join('\n'),
  );
  step(
    'tarball 不含 src/test',
    !entries.some((e) => /^package\/(src|test)\//.test(e)),
    entries.join('\n'),
  );

  // 打包 manifest：workspace:/catalog: 必须已被解析（③⑤ 回归守卫）
  const manifestOut = run('tar', ['-xzf', tarball, '-O', 'package/package.json']);
  step('manifest 提取', manifestOut.status === 0, fmt(manifestOut));
  const manifest = JSON.parse(manifestOut.stdout);
  const depSpecs = JSON.stringify({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  });
  step(
    'manifest 无 workspace:/catalog: 残留',
    !depSpecs.includes('workspace:') && !depSpecs.includes('catalog:'),
    depSpecs,
  );
  for (const external of EXTERNALS) {
    step(
      `manifest 声明 external ${external}`,
      manifest.dependencies?.[external] !== undefined,
      depSpecs,
    );
  }

  // 仓外装 tarball（④⑤：bin 链接 + 依赖面从 registry 落地）
  writeFileSync(
    join(installDir, 'package.json'),
    `${JSON.stringify({ name: 'cairn-cli-smoke', private: true }, null, 2)}\n`,
  );
  const installed = run('npm', ['install', tarball], { cwd: installDir });
  step('npm install tarball', installed.status === 0, fmt(installed));

  const installedBin = join(installDir, 'node_modules', pkg.name, BIN_PATH);

  // 裸 node 直跑 dist 产物（①：__require 桩不炸）
  const help = run('node', [installedBin, '--help']);
  step(
    'node <dist/cli.mjs> --help 退出 0 且含 Usage',
    help.status === 0 && help.stdout.includes('Usage:'),
    fmt(help),
  );

  // --version 与 package.json 单源一致（⑥）
  const version = run('node', [installedBin, '--version']);
  step(
    '--version === package.json version',
    version.status === 0 && version.stdout.trim() === pkg.version,
    fmt(version),
  );

  // .bin 符号链接入口（npm exec 真实形态；入口守卫 realpath 面）
  const binLink = run('node', [join(installDir, 'node_modules', '.bin', BIN_NAME), '--version']);
  step(
    'node <.bin/cairn> --version === package.json version',
    binLink.status === 0 && binLink.stdout.trim() === pkg.version,
    fmt(binLink),
  );
} catch (err) {
  if (!(err instanceof SmokeStepError)) throw err;
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(installDir, { recursive: true, force: true });
}
