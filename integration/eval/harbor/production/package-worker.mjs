import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const require = createRequire('/deps/apps/daemon/entry.mjs');
const { build } = require('esbuild');
const blockedEntry = /^(?:\.git|tests?|__tests__|eval|grader)$/;
const packageRoots = new Map();
const sourceRoots = [
  '/source/apps/daemon/src', '/source/packages/shared/src',
  '/source/packages/shared/merge-gate-paths.json',
  '/source/integration/eval/harbor/production/runner.mts',
  '/source/integration/eval/harbor/production/run-task.mts',
];
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const external = ['@earendil-works/pi-ai', '@earendil-works/pi-coding-agent', '@earendil-works/pi-agent-core'];
const result = await build({
  entryPoints: ['/source/integration/eval/harbor/production/run-task.mts'],
  outfile: '/output/run-task.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm',
  external, nodePaths: ['/deps/apps/daemon/node_modules', '/deps/node_modules'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  sourcemap: false, metafile: true, logLevel: 'silent', legalComments: 'none',
  tsconfigRaw: { compilerOptions: { target: 'ES2023', module: 'NodeNext', verbatimModuleSyntax: true } },
  plugins: [{ name: 'fixed-shared-seam', setup(build) {
    build.onResolve({ filter: /^@cairn\/shared(?:\/.*)?$/ }, ({ path }) => {
      if (path === '@cairn/shared') return { path: '/source/packages/shared/src/index.ts' };
      if (path === '@cairn/shared/otel') return { path: '/source/packages/shared/src/otel.ts' };
      if (path === '@cairn/shared/merge-gate') return { path: '/source/packages/shared/src/records/merge-gate.ts' };
      if (path === '@cairn/shared/github-create-gate') return { path: '/source/packages/shared/src/github-create-gate.ts' };
      throw new Error(`Unsupported shared entry: ${path}`);
    });
    build.onLoad({ filter: /.*/ }, ({ path }) => {
      const actual = realpathSync(path);
      if (!inside('/deps', actual) && !sourceRoots.some((root) => inside(root, actual))) {
        throw new Error('Resolved import is outside the build allowlist');
      }
    });
  } }],
});
for (const path of Object.keys(result.metafile.inputs)) {
  const actual = realpathSync(resolve('/tmp', path));
  if (!inside('/deps', actual) && !sourceRoots.some((root) => inside(root, actual))) throw new Error('Unexpected bundle input');
}
function locate(root, name) {
  let at = root;
  while (at !== dirname(at)) {
    const path = join(at, 'node_modules', name);
    if (existsSync(join(path, 'package.json'))) {
      const actual = realpathSync(path);
      if (!inside('/deps', actual)) throw new Error('Dependency escapes trusted root');
      return actual;
    }
    at = dirname(at);
  }
  throw new Error(`Missing pinned runtime dependency: ${name}`);
}
function visit(root) {
  if (packageRoots.has(root)) return;
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.name.startsWith('@cairn/') || pkg.name.startsWith('@xiechimon/cairn')) throw new Error('Workspace package cannot enter runtime dependencies');
  const id = createHash('sha256').update(relative('/deps', root)).digest('hex').slice(0, 20);
  packageRoots.set(root, { pkg, target: `/output/node_modules/.runtime/${id}`, dependencies: new Map() });
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    let dependency;
    try { dependency = locate(root, name); } catch (error) {
      if (name in (pkg.optionalDependencies ?? {})) continue;
      throw error;
    }
    visit(dependency);
    packageRoots.get(root).dependencies.set(name, dependency);
  }
}
const roots = external.map((name) => [name, locate('/deps/apps/daemon', name)]);
for (const [, root] of roots) visit(root);
function copy(root, target, path = '') {
  mkdirSync(join(target, path), { recursive: true });
  for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || blockedEntry.test(entry.name) || entry.name.endsWith('.map')) continue;
    const name = join(path, entry.name), source = join(root, name), destination = join(target, name);
    if (entry.isSymbolicLink() || lstatSync(source).isSymbolicLink()) throw new Error('Unexpected package file symlink');
    if (entry.isDirectory()) copy(root, target, name);
    else copyFileSync(source, destination);
  }
}
for (const [root, item] of packageRoots) copy(root, item.target);
function link(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(relative(dirname(path), target), path);
}
for (const item of packageRoots.values()) {
  for (const [name, root] of item.dependencies) link(packageRoots.get(root).target, join(item.target, 'node_modules', name));
}
for (const [name, root] of roots) link(packageRoots.get(root).target, join('/output/node_modules', name));
const bundle = readFileSync('/output/run-task.mjs');
process.stdout.write(JSON.stringify({
  bundleSha256: createHash('sha256').update(bundle).digest('hex'), bundleBytes: bundle.length,
  packages: [...packageRoots.values()].map(({ pkg }) => ({ name: pkg.name, version: pkg.version })).sort((a,b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)),
}));
