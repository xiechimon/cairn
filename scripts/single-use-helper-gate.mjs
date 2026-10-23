import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isArrowFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isVariableDeclaration,
  SyntaxKind,
} from 'typescript/unstable/ast';
import { API, SymbolFlags } from 'typescript/unstable/sync';

let api;
try {
  const base = process.env.SINGLE_USE_HELPER_BASE_SHA || 'origin/main';
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const allowlist = JSON.parse(readFileSync('scripts/single-use-helper-allowlist.json', 'utf8'));
  if (
    !Array.isArray(allowlist) ||
    allowlist.some(
      (entry) =>
        typeof entry?.path !== 'string' ||
        typeof entry.name !== 'string' ||
        typeof entry.reason !== 'string' ||
        !entry.reason.trim(),
    )
  ) {
    throw new Error('Allowlist entries require path, name and reason');
  }
  const changedFiles = git(
    'diff',
    '--name-only',
    '-z',
    '--diff-filter=ACMR',
    base,
    '--',
    'apps',
    'packages',
    'scripts',
  )
    .split('\0')
    .filter((path) => /\.(ts|tsx|mjs)$/.test(path));
  const files = [...new Set([...changedFiles, ...allowlist.map((entry) => entry.path)])];
  let violations = 0;
  if (files.length) {
    const config = resolve('.single-use-helper-gate.virtual.json');
    api = new API({
      fs: {
        readFile: (path) =>
          path === config
            ? JSON.stringify({
                compilerOptions: {
                  allowJs: true,
                  noLib: true,
                  noResolve: true,
                  jsx: 'preserve',
                  types: [],
                },
                files: files.map((path) => resolve(path)),
              })
            : undefined,
      },
    });
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    const { program, checker } = snapshot.getProjects()[0];
    for (const path of files) {
      const added = new Set();
      let line = 0;
      for (const patchLine of git(
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--unified=0',
        base,
        '--',
        path,
      ).split('\n')) {
        const hunk = /^@@ .* \+(\d+)/.exec(patchLine);
        if (hunk) line = Number(hunk[1]);
        else if (patchLine.startsWith('+') && !patchLine.startsWith('+++')) added.add(line++);
        else if (patchLine.startsWith(' ')) line++;
      }
      const source = program.getSourceFile(resolve(path));
      if (!source) throw new Error(`Cannot parse ${path}`);
      const diagnostics = program.getSyntacticDiagnostics(resolve(path));
      if (diagnostics.length)
        throw new Error(`Cannot parse ${path}: ${diagnostics[0].messageText}`);
      const module = checker.getSymbolAtLocation(source);
      const exported = new Set(
        module
          ? checker
              .getExportsOfModule(module)
              .map((symbol) =>
                symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol).id : symbol.id,
              )
          : [],
      );
      const names = new Set();
      const visit = (node) => {
        if (
          (isFunctionDeclaration(node) && node.body && node.name) ||
          (isVariableDeclaration(node) &&
            isIdentifier(node.name) &&
            node.initializer &&
            (isArrowFunction(node.initializer) || isFunctionExpression(node.initializer)))
        ) {
          const name = node.name;
          names.add(name.text);
          const start = node.getStart(source);
          const firstLine = source.getLineAndCharacterOfPosition(start).line + 1;
          const symbol = checker.getSymbolAtLocation(name);
          const declarationParent = isVariableDeclaration(node) ? node.parent.parent : node;
          const directlyExported = declarationParent.modifiers?.some(
            (modifier) => modifier.kind === SyntaxKind.ExportKeyword,
          );
          if (symbol && !exported.has(symbol.id) && !directlyExported && added.has(firstLine)) {
            const references = checker
              .getReferencesToSymbolInFile(resolve(path), symbol)
              .filter(
                (reference) => reference.resolve()?.getStart(source) !== name.getStart(source),
              );
            if (
              references.length === 1 &&
              !allowlist.some((entry) => entry.path === path && entry.name === name.text)
            ) {
              console.error(
                `${path}:${firstLine}: single-use non-exported function ${name.text}; inline it or add a named allowlist entry`,
              );
              violations++;
            }
          }
        }
        node.forEachChild(visit);
      };
      visit(source);
      for (const entry of allowlist.filter((entry) => entry.path === path)) {
        if (!names.has(entry.name))
          throw new Error(`Allowlist function ${entry.name} does not exist in ${path}`);
      }
    }
  }
  console.log(`single-use-helper-gate: ${violations} single-use helper(s)`);
  process.exitCode = violations ? 1 : 0;
} catch (error) {
  console.error(`single-use-helper-gate: ${error.message}`);
  process.exitCode = 2;
} finally {
  api?.close();
}
