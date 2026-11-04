import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast';

const ALLOCATORS = new Set(['mkdtemp', 'mkdtempSync']);
const TEST_SOURCE =
  /^(?:apps\/[^/]+\/test\/|apps\/web\/e2e\/|integration\/|packages\/[^/]+\/test\/).*\.[cm]?[jt]sx?$|^scripts\/.*\.test\.[cm]?[jt]sx?$/;

function sourceTokens(source, file) {
  const scanner = createScanner(true, LanguageVariant.Standard, source);
  const tokens = [];
  const templates = [];
  let braces = 0;
  let lastEnd = -1;
  for (;;) {
    let kind = scanner.scan();
    if (kind === SyntaxKind.EndOfFile) break;
    if (kind === SyntaxKind.CloseBraceToken && templates.at(-1) === braces) {
      kind = scanner.reScanTemplateToken(false);
      if (kind === SyntaxKind.TemplateTail) templates.pop();
    } else if (kind === SyntaxKind.OpenBraceToken) braces += 1;
    else if (kind === SyntaxKind.CloseBraceToken) braces -= 1;
    if (kind === SyntaxKind.TemplateHead) templates.push(braces);
    if (
      kind === SyntaxKind.SlashToken &&
      (!tokens.length ||
        /^(?:=|\(|\[|\{|,|:|=>|return|case|!|\|\||&&|\?\?|\?|;)$/.test(tokens.at(-1).text))
    )
      kind = scanner.reScanSlashToken();
    const end = scanner.getTokenEnd();
    if (end <= lastEnd) throw new SyntaxError(`Scanner made no progress in ${file}:${end}`);
    lastEnd = end;
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      value: scanner.getTokenValue(),
      offset: scanner.getTokenStart(),
    });
  }
  return tokens;
}

export function rawAllocationSites(source, file = 'fixture.ts') {
  const tokens = sourceTokens(source, file);
  const names = new Set(ALLOCATORS);
  let previous;
  do {
    previous = names.size;
    for (let start = 0; start < tokens.length; start += 1) {
      if (!['const', 'let', 'var'].includes(tokens[start].text) || tokens[start + 1]?.text !== '{')
        continue;
      const end = tokens.findIndex((token, index) => index > start + 1 && token.text === '}');
      if (end === -1 || tokens[end + 1]?.text !== '=') continue;
      for (let index = start + 2; index < end; index += 1) {
        if (
          names.has(tokens[index].text) &&
          tokens[index + 1]?.text === ':' &&
          tokens[index + 2]?.kind === SyntaxKind.Identifier
        ) {
          names.add(tokens[index + 2].text);
        }
      }
    }
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.kind !== SyntaxKind.Identifier || !names.has(token.text)) continue;
      if (tokens[i + 1]?.text === 'as' && tokens[i + 2]?.kind === SyntaxKind.Identifier) {
        names.add(tokens[i + 2].text);
      }
      const aliasEnd = tokens[i - 1]?.text === '.' ? i - 2 : i;
      if (
        tokens[i + 1]?.text !== '(' &&
        tokens[aliasEnd - 1]?.text === '=' &&
        tokens[aliasEnd - 2]?.kind === SyntaxKind.Identifier
      ) {
        names.add(tokens[aliasEnd - 2].text);
      }
    }
  } while (names.size !== previous);
  const sites = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const identifierCall =
      token.kind === SyntaxKind.Identifier &&
      names.has(token.text) &&
      (tokens[i + 1]?.text === '(' ||
        (tokens[i + 1]?.text === '?.' && tokens[i + 2]?.text === '('));
    const bracketCall =
      token.kind === SyntaxKind.StringLiteral &&
      ALLOCATORS.has(token.value) &&
      tokens[i - 1]?.text === '[' &&
      tokens[i + 1]?.text === ']' &&
      tokens[i + 2]?.text === '(';
    if (!identifierCall && !bracketCall) continue;
    const preceding = source.slice(0, token.offset).split('\n');
    sites.push({
      file,
      line: preceding.length,
      column: preceding.at(-1).length + 1,
      call: bracketCall ? token.value : token.text,
    });
  }
  return sites;
}

export function trackedAllocationSites(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => TEST_SOURCE.test(file))
    .flatMap((file) => rawAllocationSites(readFileSync(join(root, file), 'utf8'), file));
}

export function inventoryKeys(markdown) {
  return [...markdown.matchAll(/^\| `([^`]+:\d+:\d+)` \|/gm)].map((match) => match[1]);
}

export const allocationKey = ({ file, line, column }) => `${file}:${line}:${column}`;
