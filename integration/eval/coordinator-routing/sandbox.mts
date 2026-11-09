import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ProviderConfig } from '@cairn/shared';
import { spawnOwned } from '../../../scripts/owned-process.mjs';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { decisionOutput, type ReplayInput, replayInput } from './contract.mts';

export const CANDIDATE_COORDINATOR_PATHS = [
  'apps/server/src/coordinator/runtime',
  'apps/server/src/services/chief.ts',
  'apps/server/src/services/chief-tools.ts',
  'apps/server/src/services/chief-router-tools.ts',
  'packages/shared/src/protocol/chief-tools.ts',
];
const ruler = resolve(import.meta.dirname, '../../..');

export async function runSandboxedTurn(
  input: ReplayInput,
  provider: ProviderConfig,
  key: string,
  timeoutMs: number,
  thinking = 'low',
  checkout = resolve(import.meta.dirname, '../../..'),
): Promise<unknown> {
  provider = { ...provider, apiKey: undefined };
  replayInput.parse(input);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000)
    throw new Error('Invalid turn deadline');
  const dir = makeTestTempDir('eval-langfuse-turn-');
  const socket = join(dir, 'model.sock');
  const origin = new URL(provider.baseUrl || 'https://chatgpt.com/backend-api').origin;
  let denied = false;
  const controller = new AbortController();
  const proxy = createServer(async (req, res) => {
    try {
      const target = new URL(
        new URL(req.url ?? '/', 'http://local').searchParams.get('target') ?? '',
      );
      if (target.origin !== origin) {
        denied = true;
        res.writeHead(403).end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8_000_000) throw new Error('Model request too large');
        chunks.push(Buffer.from(chunk));
      }
      const headers = { ...req.headers };
      delete headers.host;
      delete headers['content-length'];
      headers.authorization = `Bearer ${key}`;
      if (!provider.baseUrl)
        headers['chatgpt-account-id'] = JSON.parse(
          Buffer.from(key.split('.')[1] ?? '', 'base64url').toString(),
        )['https://api.openai.com/auth'].chatgpt_account_id;
      const upstream = await fetch(target, {
        method: req.method,
        headers: headers as Record<string, string>,
        body: req.method === 'GET' ? undefined : Buffer.concat(chunks),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
        redirect: 'error',
      });
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete('content-encoding');
      responseHeaders.delete('content-length');
      res.writeHead(upstream.status, Object.fromEntries(responseHeaders));
      if (upstream.body)
        Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res);
      else res.end();
    } catch {
      res.writeHead(502).end();
    }
  });
  let owned: ReturnType<typeof spawnOwned> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((done, fail) => {
      proxy.once('error', fail);
      proxy.listen(socket, done);
    });
    const paths = [
      ...new Set([
        '/usr',
        '/lib',
        '/lib64',
        '/etc/ssl/certs',
        ...['apps', 'packages', 'integration', 'scripts', 'package.json'].map((p) =>
          join(ruler, p),
        ),
        realpathSync(join(ruler, 'node_modules')),
        realpathSync(process.execPath),
      ]),
    ];
    owned = spawnOwned(
      'bwrap',
      [
        '--die-with-parent',
        '--unshare-all',
        ...paths.flatMap((p) => ['--ro-bind', p, p]),
        ...CANDIDATE_COORDINATOR_PATHS.flatMap((p) => {
          const source = realpathSync(join(checkout, p));
          if (!source.startsWith(`${realpathSync(checkout)}/`))
            throw new Error('Candidate source escaped checkout');
          return ['--ro-bind', source, join(ruler, p)];
        }),
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--bind',
        dir,
        dir,
        '--tmpfs',
        '/tmp',
        '--chdir',
        dir,
        '--',
        process.execPath,
        '--import',
        import.meta.resolve('tsx'),
        join(ruler, 'integration/eval/coordinator-routing/worker.mts'),
      ],
      {
        env: {
          PATH: process.env.PATH,
          HOME: dir,
          TMPDIR: dir,
          CAIRN_HEAVY_SLOTS_DIR: process.env.CAIRN_HEAVY_SLOTS_DIR ?? '/tmp/cairn-heavy-slots',
        },
        stdio: ['pipe', 'pipe', 'ignore'],
        graceMs: 0,
        maxRuntimeSec: Math.ceil(timeoutMs / 1000) + 1,
      },
    );
    let output = '';
    let overflow = false;
    let timedOut = false;
    const active = owned;
    timer = setTimeout(() => {
      timedOut = true;
      void active.stop();
    }, timeoutMs);
    owned.child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 262144) {
        overflow = true;
        void active.stop();
      }
    });
    owned.child.stdin.end(JSON.stringify({ input, provider, thinking, socket }));
    const result = await owned.exited;
    if (timedOut || denied || overflow || result.code !== 0)
      throw new Error(
        `incomplete: worker exit ${result.code ?? result.signal}, timeout=${timedOut}, uncaptured=${denied}`,
      );
    return decisionOutput.parse(JSON.parse(output));
  } finally {
    clearTimeout(timer);
    controller.abort();
    await owned?.stop();
    proxy.closeAllConnections();
    await new Promise<void>((done) => proxy.close(() => done()));
    releaseTestTempDir(dir);
  }
}
