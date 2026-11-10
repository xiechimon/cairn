import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const ruler = resolve(import.meta.dirname, '../../..');
const require = createRequire(import.meta.resolve('tsx'));
type Resolution = { path: string; errors?: unknown[]; external?: boolean };
type ResolveArgs = { path: string; importer: string; kind: string; pluginData?: boolean };
type GraphBuild = {
  resolve: (path: string, options: Record<string, unknown>) => Promise<Resolution>;
  onResolve: (options: { filter: RegExp }, callback: (args: ResolveArgs) => unknown) => void;
  onLoad: (options: { filter: RegExp }, callback: (args: { path: string }) => unknown) => void;
};
const esbuild = require('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{
    metafile: { inputs: Record<string, unknown> };
    warnings: unknown[];
  }>;
};

function isCandidateSource(path: string): boolean {
  return (
    !path.startsWith('../') &&
    !path.includes('node_modules/') &&
    !path.startsWith('integration/eval/coordinator-routing/')
  );
}

export function candidateSource(checkout: string, path: string): string {
  const source = realpathSync(join(checkout, path));
  if (!source.startsWith(`${realpathSync(checkout)}/`))
    throw new Error('Candidate source escaped checkout');
  return source;
}

export async function candidateClosure(checkout: string): Promise<string[]> {
  const result = await esbuild.build({
    absWorkingDir: ruler,
    entryPoints: ['integration/eval/coordinator-routing/worker.mts'],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
    plugins: [
      {
        name: 'candidate-source-graph',
        setup(build: GraphBuild) {
          build.onResolve({ filter: /^(\.|@cairn\/shared(?:\/|$))/ }, async (args) => {
            if (args.pluginData || !args.importer) return;
            if (args.path.startsWith('@cairn/shared'))
              return { path: createRequire(args.importer).resolve(args.path) };
            const rel = relative(ruler, args.importer);
            const candidate = join(checkout, rel);
            const fromCandidate = isCandidateSource(rel);
            const resolved = await build.resolve(args.path, {
              resolveDir: dirname(fromCandidate ? candidate : args.importer),
              kind: args.kind,
              pluginData: true,
            });
            if (resolved.path.startsWith(`${resolve(checkout)}/`))
              return { path: join(ruler, relative(checkout, resolved.path)) };
            return resolved;
          });
          build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, ({ path }) => {
            const rel = relative(ruler, path);
            if (!isCandidateSource(rel)) return;
            if (!existsSync(path)) throw new Error(`Unsupported candidate dependency: ${rel}`);
            const source = candidateSource(checkout, rel);
            return {
              contents: readFileSync(source, 'utf8'),
              loader: path.endsWith('tsx') ? 'tsx' : 'ts',
              resolveDir: dirname(path),
            };
          });
        },
      },
    ],
  });
  if (result.warnings.length) throw new Error('Incomplete candidate import graph');
  const sources = Object.keys(result.metafile.inputs).filter(isCandidateSource);
  const metadata = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']);
  for (const source of sources) {
    for (let dir = dirname(source); dir !== '.'; dir = dirname(dir)) {
      for (const name of ['package.json', 'tsconfig.json']) {
        const path = join(dir, name);
        if (existsSync(join(ruler, path))) metadata.add(path);
      }
    }
  }
  for (const path of metadata) {
    if (!readFileSync(candidateSource(checkout, path)).equals(readFileSync(join(ruler, path))))
      throw new Error(`Unsupported candidate runtime configuration: ${path}`);
  }
  return [...new Set([...sources, ...metadata])].sort();
}
