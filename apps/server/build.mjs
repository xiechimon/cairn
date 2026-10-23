// esbuild 单文件 bundle（06 册 §11 W2-D2：主包 `@xiechimon/cairn` 的 server
// 产物 = 单 ESM 文件，承 daemon `build.mjs` 先例）。JS 依赖全打入；native 的
// better-sqlite3 外置为 external 运行时依赖（Node 22/24 LTS 预编译覆盖，
// W2-D3 留现状决议）。shebang 供 bin 字段直跑（npx 主路径）。

import { build } from 'esbuild';

// bundle-form 标记替换：src/bundle-form.ts 的 BUNDLED_FORM=false 只描述 src
// 直跑形态；bundle 里恒 true（transport 路径在单文件形态无法承载，见该文件
// 头注）。onLoad 整模块替换——esbuild define 不作用于模块作用域标识符
// （实测 2026-09-25），define 路线不通，此为确定性最强的开关。
const bundleFormFlag = {
  name: 'cairn-bundle-form',
  setup(b) {
    b.onLoad({ filter: /src[\\/]bundle-form\.ts$/ }, () => ({
      contents: 'export const BUNDLED_FORM = true;',
      loader: 'js',
    }));
  },
};

// banner 三件：shebang（bin 直跑）+ pino CJS 动态 require 垫片。pino.js 顶层
// `require('node:os')` 经 esbuild CJS 包装后走 __require 桩（运行期动态解析，
// 不静态折叠），ESM 无 require 即抛「Dynamic require … not supported」——桩的
// 兜底是 `typeof require !== "undefined"`，故注入 createRequire 令其落到真
// require。同病已实测存在于 daemon bundle（dist/cli.mjs 裸跑同炸，发布票
// 前从未被裸跑验证），cli 改名票应携同款垫片。
const banner = [
  '#!/usr/bin/env node',
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
].join('\n');

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['better-sqlite3'],
  plugins: [bundleFormFlag],
  banner: { js: banner },
  sourcemap: true,
  logLevel: 'info',
});
