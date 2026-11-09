import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
const { default: tailwind } = await import(pathToFileURL(require.resolve('@tailwindcss/postcss')).href);
const server = await createServer({
  configFile: false,
  root,
  publicDir: `${root}apps/web/public`,
  plugins: [react(), {
    name: 'no-product-network',
    configureServer(instance) {
      instance.middlewares.use((req, res, next) => {
        if (/^\/(api|git)(\/|$)/.test(req.url ?? '')) {
          res.statusCode = 403;
          res.end('Prototype has no product API');
        } else next();
      });
    },
  }],
  resolve: {
    alias: [
      { find: '@', replacement: `${root}apps/web/src` },
      { find: /^diff$/, replacement: `${root}apps/web/node_modules/diff` },
      { find: /^cn$/, replacement: `${root}apps/web/src/lib/cn.ts` },
      { find: 'react-dom', replacement: `${root}apps/web/node_modules/react-dom` },
      { find: 'react', replacement: `${root}apps/web/node_modules/react` },
    ],
  },
  css: { postcss: { plugins: [tailwind()] } },
  server: { host: '127.0.0.1', port: 8796, strictPort: true },
});
await server.listen();
console.log('Memory in-place fixture server listening on 8796');
