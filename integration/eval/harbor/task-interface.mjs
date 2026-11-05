import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { API } from 'typescript/unstable/sync';
import * as ts from 'typescript/unstable/ast';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const input = JSON.parse(
  await new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', reject);
  }),
);
const scratch = makeTestTempDir('cairn-task-interface-');
const filename = path.join(scratch, `input${path.extname(input.path) || '.ts'}`);
fs.writeFileSync(filename, input.source);
const api = new API({ cwd: scratch });
const snapshot = api.updateSnapshot({ openFiles: [filename] });
try {
  const program = snapshot.getDefaultProjectForFile(filename).program;
  if (program.getSyntacticDiagnostics(filename).length) throw new Error('Invalid source syntax');
  const source = program.getSourceFile(filename);
  const imported = new Set(input.names);
  const inputTypes = new Set();
  function typeText(node) {
    if (!node) return 'unknown';
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName))
      inputTypes.add(node.typeName.text);
    const edits = [];
    function visit(child) {
      if (ts.isTypeQueryNode(child)) {
        edits.push([child.getStart(source), child.end, 'unknown']);
        return;
      }
      if (ts.isLiteralTypeNode(child)) {
        let replacement;
        if (ts.isStringLiteral(child.literal)) replacement = 'string';
        else if (ts.isNumericLiteral(child.literal) || ts.isPrefixUnaryExpression(child.literal))
          replacement = 'number';
        else if (
          [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(child.literal.kind)
        )
          replacement = 'boolean';
        if (replacement) edits.push([child.getStart(source), child.end, replacement]);
      }
      if (ts.isTypeReferenceNode(child) && ts.isIdentifier(child.typeName))
        inputTypes.add(child.typeName.text);
      child.forEachChild(visit);
    }
    visit(node);
    const start = node.getStart(source);
    let text = node.getText(source);
    for (const [from, to, replacement] of edits.sort((a, b) => b[0] - a[0])) {
      text = text.slice(0, from - start) + replacement + text.slice(to - start);
    }
    text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return text;
  }
  function objectBindingType(pattern) {
    if (
      pattern.elements.some(
        (element) =>
          element.dotDotDotToken ||
          !element.name ||
          !ts.isIdentifier(element.name) ||
          (element.propertyName && !ts.isIdentifier(element.propertyName)),
      )
    )
      return 'unknown';
    const fields = pattern.elements.map((element) => {
      const name = element.propertyName || element.name;
      return `${name.text}${element.initializer ? '?' : ''}: unknown`;
    });
    return `{ ${fields.join('; ')} }`;
  }
  function parameters(node) {
    return node.parameters
      .map((parameter) => {
        if (ts.isObjectBindingPattern(parameter.name) && !parameter.type)
          return `input${parameter.initializer ? '?' : ''}: ${objectBindingType(parameter.name)}`;
        if (!ts.isIdentifier(parameter.name)) return `input: ${typeText(parameter.type)}`;
        return `${parameter.dotDotDotToken ? '...' : ''}${parameter.name.text}${parameter.questionToken || parameter.initializer ? '?' : ''}: ${typeText(parameter.type)}`;
      })
      .join(', ');
  }
  function publicMember(member) {
    return !member.modifiers?.some((modifier) =>
      [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind),
    );
  }
  const imports = [];
  const publicExports = [];
  const reexports = [];
  const starExports = [];
  const unsupportedExports = [];
  const assertionLiterals = new Set();
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        imports.push({
          path: node.moduleSpecifier.text,
          names: bindings.elements.map((entry) => (entry.propertyName || entry.name).text),
        });
    }
  }
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const modulePath = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : null;
      if (!node.exportClause) starExports.push(modulePath);
      else if (ts.isNamedExports(node.exportClause)) {
        for (const entry of node.exportClause.elements) {
          if (entry.isTypeOnly || !ts.isIdentifier(entry.name)) continue;
          const sourceName = entry.propertyName || entry.name;
          if (!ts.isIdentifier(sourceName) || sourceName.text === 'default') {
            unsupportedExports.push(entry.name.text);
            continue;
          }
          if (node.moduleSpecifier)
            reexports.push({ name: entry.name.text, sourceName: sourceName.text, path: modulePath });
          else publicExports.push({ name: entry.name.text, localName: sourceName.text });
        }
      } else if (ts.isNamespaceExport(node.exportClause))
        unsupportedExports.push(node.exportClause.name.text);
    }
    const modifiers = node.modifiers || [];
    if (
      !modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
      modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    )
      continue;
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name))
          publicExports.push({ name: declaration.name.text, localName: declaration.name.text });
      }
    } else if (node.name && ts.isIdentifier(node.name))
      publicExports.push({ name: node.name.text, localName: node.name.text });
  }
  function collectAssertions(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (
        /^(toBe|toEqual|toStrictEqual|toContain|toMatch|equal|deepEqual|strictEqual|match)/.test(
          name,
        )
      ) {
        function collectLiteral(child) {
          if (ts.isStringLiteral(child)) assertionLiterals.add(child.text);
          child.forEachChild(collectLiteral);
        }
        for (const argument of node.arguments) collectLiteral(argument);
      }
    }
    node.forEachChild(collectAssertions);
  }
  collectAssertions(source);
  const declarations = new Map();
  for (const node of source.statements) {
    if (node.name && ts.isIdentifier(node.name)) declarations.set(node.name.text, node);
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
      }
    }
  }
  const lines = [];
  for (const name of [...imported].sort()) {
    const node = declarations.get(name);
    if (!node) continue;
    const publicNames = Object.hasOwn(input.publicNames || {}, name)
      ? input.publicNames[name]
      : [name];
    for (const publicName of publicNames) {
      if (ts.isFunctionDeclaration(node))
        lines.push(`function ${publicName}(${parameters(node)}): unknown;`);
      else if (ts.isClassDeclaration(node)) {
        lines.push(`class ${publicName} {`);
        for (const member of node.members.filter(publicMember)) {
          if (ts.isConstructorDeclaration(member))
            lines.push(`  constructor(${parameters(member)});`);
          else if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
            const prefix = member.modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword,
            )
              ? 'static '
              : '';
            lines.push(`  ${prefix}${member.name.text}(${parameters(member)}): unknown;`);
          }
        }
        lines.push('}');
      } else if (ts.isVariableDeclaration(node)) {
        if (
          node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        )
          lines.push(`function ${publicName}(${parameters(node.initializer)}): unknown;`);
        else lines.push(`const ${publicName}: unknown;`);
      }
    }
  }

  const seen = new Set();
  while ([...inputTypes].some((name) => !seen.has(name))) {
    for (const name of [...inputTypes].sort()) {
      if (seen.has(name)) continue;
      seen.add(name);
      const node = declarations.get(name);
      if (node && ts.isInterfaceDeclaration(node)) {
        const fields = node.members
          .filter(ts.isPropertySignatureDeclaration)
          .map((field) => {
            if (!ts.isIdentifier(field.name)) return null;
            return `  ${field.name.text}${field.postfixToken?.kind === ts.SyntaxKind.QuestionToken ? '?' : ''}: ${typeText(field.type)};`;
          })
          .filter(Boolean);
        lines.push(`interface ${name} {`, ...fields, '}');
      } else if (node && ts.isTypeAliasDeclaration(node))
        lines.push(`type ${name} = ${typeText(node.type)};`);
    }
  }
  process.stdout.write(
    JSON.stringify({
      path: path.posix.normalize(input.path),
      declarations: lines.join('\n'),
      imports,
      publicExports,
      reexports,
      starExports,
      unsupportedExports,
      assertionLiterals: [...assertionLiterals].sort(),
    }),
  );
} finally {
  snapshot.dispose();
  api.close();
  releaseTestTempDir(scratch);
}
