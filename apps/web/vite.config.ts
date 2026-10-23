import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// dev 端口从 CAIRN_DEV_WEB_PORT 读，缺省 5173（= vite 默认，与 proxy 侧的
// CAIRN_DEV_SERVER_PORT 对称）。空串/非法值同样回落缺省。
const devWebPort = Number(process.env.CAIRN_DEV_WEB_PORT) || 5173;

// dev 期 proxy → server（01 §4.1 构建行；M5 live 数据源同源化——cookie 会话
// 与 SSE 免 CORS）。目标端口 = CAIRN_DEV_SERVER_PORT，缺省 8787
// （apps/server/src/config.ts 的 PORT 缺省）。preview 形态不经 proxy
// （静态托管/fixture）。
/** preview 下 /api、/git 一律 404（#483）。preview 是静态托管面，这两个前缀
 *  没有任何后端可代理；只清空 preview.proxy 的话它们会落进 SPA fallback 回
 *  `200 text/html`——那比原来的 502 更坏：`res.ok` 型判据（auth.ts 的
 *  probeToken 就是 `return res.ok`）会把「拿到一页 HTML」读成「接口通了」。
 *  显式 404 保住失败形态（非 401，故不触令牌门），同时不留 proxy error 噪音。 */
function previewApiReject(): Plugin {
  const PREFIXES = ['/api', '/git'];
  const isApiPath = (url: string) =>
    PREFIXES.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`));
  return {
    name: 'preview-api-reject',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!isApiPath(req.url ?? '')) {
          next();
          return;
        }
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end('{"error":"not found"}');
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), previewApiReject()],
  // @/* 别名（#425）：shadcn CLI 的 preflight 硬查 import alias——tsconfig
  // paths 与 vite resolve 两处都要有，缺一则 CLI 直接退出。既有相对 import
  // 不受影响。
  // 裸 `cn` 指向 src/lib/cn.ts（带 Paper 字号键的 createCn 实例）：正则只
  // 匹配裸名，`cn/config` 仍落到包本身。vitest.config.ts 与 tsconfig paths 同值。
  resolve: {
    alias: [
      { find: '@', replacement: new URL('./src', import.meta.url).pathname },
      { find: /^cn$/, replacement: new URL('./src/lib/cn.ts', import.meta.url).pathname },
    ],
  },
  server: {
    port: devWebPort,
    // strictPort：vite 缺省「被占就静默 +1」在多栈并行下有两重害处——界面
    // 地址每次漂移，且 proxy 仍指向本栈 server 之外（界面实际驱动的是别人
    // 的栈）。撞端口即启动失败，换号走 CAIRN_DEV_WEB_PORT。
    strictPort: true,
    // watch 排除 .claude/**——并行 agent worktree 落在仓内任意深度的
    // .claude/worktrees/ 时,其 pnpm install/构建动静会触发 vite 全量重载
    // 风暴把 dev 拖死(实证 2026-09-24:嵌套 worktree 引发 reload 刷屏)。
    watch: { ignored: ['**/.claude/**'] },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.CAIRN_DEV_SERVER_PORT ?? 8787}`,
        changeOrigin: true,
      },
      '/git': {
        target: `http://127.0.0.1:${process.env.CAIRN_DEV_SERVER_PORT ?? 8787}`,
        changeOrigin: true,
      },
    },
  },
  // preview 显式清空 proxy（#483）：上面「preview 形态不经 proxy」那句一直
  // 是**意图**不是事实——vite 的 preview **默认继承 server.proxy**。CI 的
  // e2e 走 `vite preview` 而 8787 无人监听，可 16 处不带 `?scenario=` 的 e2e
  // 导航会落 live 模式（LiveDataBridge 在 live 下发 /api/teams 与
  // /api/user/me），于是每轮 CI 刷十几条 `[vite] http proxy error …
  // ECONNREFUSED`：日志被污染，归因被带偏（#462 面一最初就把它记成了 m5
  // 症状）。preview/fixture 是静态托管面，本就不该代理。
  preview: {
    proxy: {},
  },
});
