import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const WEB_DIR = resolve(import.meta.dirname, '..');
const VITE_BIN = join(
  resolve(createRequire(import.meta.url).resolve('vite/package.json'), '..'),
  'bin',
  'vite.js',
);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

export interface BuiltSite {
  base: string;
  dist: string;
  dispose: () => Promise<void>;
}

export async function buildAndServe(mode: 'demo' | 'production'): Promise<BuiltSite> {
  const dist = mkdtempSync(join(tmpdir(), `cairn-e2e-${mode}-`));
  execFileSync(
    process.execPath,
    [VITE_BIN, 'build', '--mode', mode, '--outDir', dist, '--emptyOutDir'],
    { cwd: WEB_DIR, stdio: 'pipe' },
  );
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (pathname.startsWith('/api') || pathname.startsWith('/git')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not found"}');
      return;
    }
    const candidate = join(dist, normalize(pathname));
    const isFile = candidate.startsWith(dist) && existsSync(candidate) && statSync(candidate).isFile();
    const file = isFile ? candidate : join(dist, 'index.html');
    res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('static server has no port');
  return {
    base: `http://127.0.0.1:${address.port}`,
    dist,
    dispose: async () => {
      await new Promise<void>((done) => server.close(() => done()));
      rmSync(dist, { recursive: true, force: true });
    },
  };
}
