import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const devWebPort = Number(process.env.CAIRN_DEV_WEB_PORT) || 5173;
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const insideClaudeDir = (file: string) =>
  file.startsWith(repoRoot)
    ? file.slice(repoRoot.length).includes('/.claude/')
    : file.includes('/.claude/');

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

const WHITEBOARD_FONTS_URL = '/whiteboard-assets/fonts';
const WHITEBOARD_FONTS_SKIPPED = 'Xiaolai';

function whiteboardFonts(): Plugin {
  const fontsDir = fileURLToPath(
    new URL('./node_modules/@excalidraw/excalidraw/dist/prod/fonts', import.meta.url),
  );
  const shipped = (path: string) =>
    !path.slice(fontsDir.length).includes(`/${WHITEBOARD_FONTS_SKIPPED}`);
  return {
    name: 'whiteboard-fonts',
    configureServer(server) {
      server.middlewares.use(WHITEBOARD_FONTS_URL, (req, res, next) => {
        const file = normalize(
          join(fontsDir, decodeURIComponent((req.url ?? '').split('?')[0] ?? '')),
        );
        if (
          !file.startsWith(fontsDir) ||
          !shipped(file) ||
          !existsSync(file) ||
          !statSync(file).isFile()
        ) {
          next();
          return;
        }
        res.setHeader('content-type', 'font/woff2');
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      if (options.dir === undefined) return;
      cpSync(fontsDir, join(options.dir, WHITEBOARD_FONTS_URL), {
        recursive: true,
        filter: shipped,
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), previewApiReject(), whiteboardFonts()],
  build:
    mode === 'fixture'
      ? { rollupOptions: { input: { main: 'index.html', design: 'design.html' } } }
      : {},
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      { find: /^cn$/, replacement: fileURLToPath(new URL('./src/lib/cn.ts', import.meta.url)) },
    ],
  },
  server: {
    port: devWebPort,
    strictPort: true,
    watch: { ignored: insideClaudeDir },
    proxy: {
      '/api/computer-screen': {
        target: `http://127.0.0.1:${process.env.CAIRN_DEV_SERVER_PORT ?? 8787}`,
        ws: true,
        changeOrigin: false,
      },
      '/api/machine/computer-screen': {
        target: `http://127.0.0.1:${process.env.CAIRN_DEV_SERVER_PORT ?? 8787}`,
        ws: true,
        changeOrigin: false,
      },
      '/api/teams': {
        target: `http://127.0.0.1:${process.env.CAIRN_DEV_SERVER_PORT ?? 8787}`,
        ws: true,
        changeOrigin: false,
      },
      '/api': {
        target: `http://127.0.0.1:${process.env.CAIRN_DEV_SERVER_PORT ?? 8787}`,
        changeOrigin: false,
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
}));
