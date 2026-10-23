// pack 期 web dist 整形（06 册 §11 W2 主包 files 面）：apps/web/dist →
// apps/server/web/ 干拷（先清后拷——vite 产物文件名带 hash，残留旧文件会随
// files 进包，包内出现永不被引用的死资产）。源缺失 = 报错带指引退出，不静默
// 出纯 API 形态的包（那是 webDir=null 的另一形态，不能由打包事故产生）。
// 产物为 gitignored 打包中间态（.gitignore apps/server/web/ 行）；dev 形态的
// webDir 双探测（config.ts）以 apps/web/dist 为先——本拷贝不遮 dev 源，只在
// apps/web/dist 缺席或包内形态生效。

import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // apps/server
const source = join(here, '..', 'web', 'dist');
const target = join(here, 'web');

if (!existsSync(join(source, 'index.html'))) {
  console.error(`web dist 缺失（${source}）——先 pnpm --filter @cairn/web build`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
