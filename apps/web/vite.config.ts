import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const devWebPort = Number(process.env.CAIRN_DEV_WEB_PORT) || 5173;

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
  resolve: {
    alias: [
      { find: '@', replacement: new URL('./src', import.meta.url).pathname },
      { find: /^cn$/, replacement: new URL('./src/lib/cn.ts', import.meta.url).pathname },
    ],
  },
  server: {
    port: devWebPort,
    strictPort: true,
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
  preview: {
    proxy: {},
  },
});
