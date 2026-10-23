// daemon 版本单源（cairn version / presence cliVersion / 版本墙形状 02 §7.1）。
// 数值 = manifest version（bump 只动 package.json；首发 0.1.1 实测坑：硬编码
// 版本串滞后 manifest——--version 报旧值）。src/ 与 dist/ 双形态下相对路径
// 一致（均在 apps/daemon/ 下一层，发布包内 = 包根 package.json）。

// 别名导入：bundle banner（build.mjs pino 垫片）已占用 createRequire 名，
// 同名导入会在 esbuild 单文件产物里重复声明（首发实测 SyntaxError）。
import { createRequire as createManifestRequire } from 'node:module';

const requireManifest = createManifestRequire(import.meta.url);
export const DAEMON_VERSION: string = (requireManifest('../package.json') as { version: string })
  .version;
