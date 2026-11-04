// Token-walk core of the i18n-coverage gate, extracted from
// i18n-coverage.test.ts so the walk itself carries regression pins
// (i18n-scan.test.ts) separately from the corpus assertions.
//
// TS 7 note: the native compiler no longer ships the old JS parser API
// (`ts.createSourceFile`); `typescript/unstable/ast` exposes the scanner, so
// this walk is a small state machine — brace depth tracks template
// substitutions (`${` … `}` rescans as template), JSX text is entered via
// `scanJsxToken` after an opening tag, and a `/` in regex position rescans as
// one RegularExpressionLiteral via `reScanSlashToken` (#681: without the
// rescan, a `#` inside a regex body scans as a zero-length PrivateIdentifier
// at the same offset forever and the walk spins). As a seatbelt for any
// future lexer shape this walk does not handle, every consumed token must
// advance the cursor — see guardAdvance (#681 acceptance: fail loudly with
// file:line:col instead of hanging).

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast';

const CJK = /[一-鿿]/;

export interface Found {
  rel: string;
  text: string;
  kind: 'literal' | 'template' | 'jsx-text' | 'translation';
}

/** Tokens after which `<` continues an expression (comparison, generic
 *  argument list) instead of opening JSX. */
const NO_JSX_AFTER = new Set<SyntaxKind>([
  SyntaxKind.Identifier,
  SyntaxKind.PrivateIdentifier,
  SyntaxKind.NumericLiteral,
  SyntaxKind.BigIntLiteral,
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateTail,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.CloseParenToken,
  SyntaxKind.CloseBracketToken,
  SyntaxKind.ThisKeyword,
  SyntaxKind.SuperKeyword,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
  SyntaxKind.NullKeyword,
]);

/** Tokens after which `/` is division, not a regex literal. CloseParenToken
 *  is conditional — a `/` right after `)` is a regex when the paren closed an
 *  if/while/for/with header (`if (a) /#/.test(s)`) — see regexAllowedAfter.
 *  CloseBraceToken deliberately forbids the rescan: at the `/>` of a JSX
 *  self-closing tag after a spread attribute (`<Foo {...p} />`) the rescan
 *  would swallow the rest of the file as an unterminated regex. A statement
 *  starting with a regex directly after a block `}` is vanishingly rare, and
 *  if one ever wedges, guardAdvance reports it instead of spinning. */
const NO_REGEX_AFTER = new Set<SyntaxKind>([
  SyntaxKind.Identifier,
  SyntaxKind.PrivateIdentifier,
  SyntaxKind.NumericLiteral,
  SyntaxKind.BigIntLiteral,
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateTail,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.CloseParenToken,
  SyntaxKind.CloseBracketToken,
  SyntaxKind.CloseBraceToken,
  SyntaxKind.PlusPlusToken,
  SyntaxKind.MinusMinusToken,
  SyntaxKind.ThisKeyword,
  SyntaxKind.SuperKeyword,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
  SyntaxKind.NullKeyword,
]);

/** Head tokens whose matching `)` may be followed by a regex literal. */
const REGEX_HEADER_AFTER = new Set<SyntaxKind>([
  SyntaxKind.IfKeyword,
  SyntaxKind.WhileKeyword,
  SyntaxKind.ForKeyword,
  SyntaxKind.WithKeyword,
]);

function tokenName(tok: SyntaxKind): string {
  for (const [name, value] of Object.entries(SyntaxKind)) {
    if (value === tok) return name;
  }
  return String(tok);
}

/** 1-based `line:col` for `pos` in `text`. */
function lineCol(text: string, pos: number): string {
  const before = text.slice(0, pos);
  return `${before.split('\n').length}:${pos - before.lastIndexOf('\n')}`;
}

/** Walk `text` and collect every CJK-bearing literal / template / JSX text.
 *  `rel` is the src-relative path used in findings and guard errors. */
export function scanSource(text: string, rel: string, includeTranslations = false): Found[] {
  const isTsx = rel.endsWith('.tsx');
  const scanner = createScanner(
    /* skipTrivia */ true,
    isTsx ? LanguageVariant.JSX : LanguageVariant.Standard,
    text,
  );
  const found: Found[] = [];
  let translationIdentifier = false;
  let translationArgument = false;
  let translationLiteral: string | undefined;
  let braceDepth = 0;
  /** braceDepth at which `}` closes the innermost template substitution. */
  const templateStack: number[] = [];
  /** per-template aggregation so one finding carries the whole raw template. */
  const openTemplates: { start: number; cjk: boolean }[] = [];
  /** head token recorded at each open `(`, for the CloseParen regex rule. */
  const parenHeads: SyntaxKind[] = [];
  let lastParenHead = SyntaxKind.Unknown;
  let rescanTemplate = false;
  let lastTok = SyntaxKind.Unknown;
  let prevTok = SyntaxKind.Unknown;

  const regexAllowedAfter = (prev: SyntaxKind): boolean => {
    if (prev === SyntaxKind.CloseParenToken) return REGEX_HEADER_AFTER.has(lastParenHead);
    return !NO_REGEX_AFTER.has(prev);
  };

  /** Zero-advance guard (#681): a token that does not move the cursor means
   *  this walk hit a lexer shape it cannot handle; throw with file:line:col
   *  instead of looping forever. */
  const guardAdvance = (tok: SyntaxKind, prevEnd: number): void => {
    if (tok !== SyntaxKind.EndOfFile && scanner.getTokenEnd() <= prevEnd) {
      const pos = scanner.getTokenStart();
      throw new Error(
        `${rel}:${lineCol(text, pos)}: i18n-coverage scanner made no progress — ${tokenName(tok)} at offset ${pos} does not advance the cursor; aborting the walk instead of spinning (#681)`,
      );
    }
  };

  /** Next token in code context; records string/template findings. */
  const advance = (): SyntaxKind => {
    const prevEnd = scanner.getTokenEnd();
    let tok = rescanTemplate ? scanner.reScanTemplateToken(false) : scanner.scan();
    rescanTemplate = false;
    if (
      (tok === SyntaxKind.SlashToken || tok === SyntaxKind.SlashEqualsToken) &&
      regexAllowedAfter(lastTok)
    ) {
      tok = scanner.reScanSlashToken(); // regex position: one literal, not body-as-code (#681)
    }
    guardAdvance(tok, prevEnd);
    if (includeTranslations) {
      if (
        translationLiteral !== undefined &&
        (tok === SyntaxKind.CommaToken || tok === SyntaxKind.CloseParenToken)
      ) {
        found.push({ rel, text: translationLiteral, kind: 'translation' });
      }
      translationLiteral =
        translationArgument &&
        (tok === SyntaxKind.StringLiteral || tok === SyntaxKind.NoSubstitutionTemplateLiteral)
          ? scanner.getTokenValue()
          : undefined;
      translationArgument = tok === SyntaxKind.OpenParenToken && translationIdentifier;
      translationIdentifier =
        (tok === SyntaxKind.QuestionDotToken && translationIdentifier) ||
        (tok === SyntaxKind.Identifier &&
          scanner.getTokenText() === 't' &&
          lastTok !== SyntaxKind.DotToken &&
          lastTok !== SyntaxKind.QuestionDotToken);
    }
    prevTok = lastTok;
    lastTok = tok;
    if (tok === SyntaxKind.OpenBraceToken) {
      braceDepth++;
    } else if (tok === SyntaxKind.CloseBraceToken) {
      const top = templateStack[templateStack.length - 1];
      if (top !== undefined && braceDepth === top) {
        rescanTemplate = true; // `}` closed a template substitution
      } else {
        braceDepth--;
      }
    } else if (tok === SyntaxKind.OpenParenToken) {
      parenHeads.push(prevTok);
    } else if (tok === SyntaxKind.CloseParenToken) {
      lastParenHead = parenHeads.pop() ?? SyntaxKind.Unknown;
    }
    if (tok === SyntaxKind.StringLiteral || tok === SyntaxKind.NoSubstitutionTemplateLiteral) {
      const v = scanner.getTokenValue();
      if (CJK.test(v)) found.push({ rel, text: v, kind: 'literal' });
    } else if (tok === SyntaxKind.TemplateHead) {
      templateStack.push(braceDepth);
      openTemplates.push({ start: scanner.getTokenStart(), cjk: CJK.test(scanner.getTokenValue()) });
    } else if (tok === SyntaxKind.TemplateMiddle) {
      const t = openTemplates[openTemplates.length - 1];
      if (t) t.cjk ||= CJK.test(scanner.getTokenValue());
    } else if (tok === SyntaxKind.TemplateTail) {
      templateStack.pop();
      const t = openTemplates.pop();
      if (t && (t.cjk || CJK.test(scanner.getTokenValue()))) {
        found.push({ rel, text: text.slice(t.start, scanner.getTokenEnd()), kind: 'template' });
      }
    }
    return tok;
  };

  /** Consume tokens until the `}` matching the `{` the caller just ate. */
  const scanCodeUntilClose = (): void => {
    const stop = braceDepth - 1;
    for (;;) {
      const tok = advance();
      if (tok === SyntaxKind.EndOfFile || braceDepth <= stop) return;
      if (isTsx && tok === SyntaxKind.LessThanToken && !NO_JSX_AFTER.has(prevTok)) {
        scanJsxElement();
      }
    }
  };

  /** LessThanToken just consumed in JSX position: eat tag + children. */
  const scanJsxElement = (): void => {
    let tok = advance();
    if (tok === SyntaxKind.EndOfFile) return;
    if (tok === SyntaxKind.GreaterThanToken) {
      scanJsxChildren(); // <> fragment
      return;
    }
    for (;;) {
      if (tok === SyntaxKind.EndOfFile) return;
      if (tok === SyntaxKind.GreaterThanToken) {
        scanJsxChildren();
        return;
      }
      if (tok === SyntaxKind.SlashToken) {
        advance(); // self-closing: consume `>`
        return;
      }
      if (tok === SyntaxKind.OpenBraceToken) {
        scanCodeUntilClose(); // spread attribute
        tok = advance();
        continue;
      }
      if (tok === SyntaxKind.EqualsToken) {
        const v = advance();
        if (v === SyntaxKind.OpenBraceToken) scanCodeUntilClose();
        // else attribute string literal — already recorded by advance()
        tok = advance();
        continue;
      }
      tok = advance(); // tag-name part or attribute name
    }
  };

  const scanJsxChildren = (): void => {
    for (;;) {
      const prevEnd = scanner.getTokenEnd();
      const tok = scanner.scanJsxToken();
      guardAdvance(tok, prevEnd);
      prevTok = lastTok;
      lastTok = tok;
      if (tok === SyntaxKind.EndOfFile) return;
      if (tok === SyntaxKind.JsxText || tok === SyntaxKind.JsxTextAllWhiteSpaces) {
        const v = scanner.getTokenText();
        if (CJK.test(v)) found.push({ rel, text: v.trim(), kind: 'jsx-text' });
        continue;
      }
      if (tok === SyntaxKind.OpenBraceToken) {
        braceDepth++;
        scanCodeUntilClose(); // { expression } container
        continue;
      }
      if (tok === SyntaxKind.LessThanToken) {
        scanJsxElement(); // nested element
        continue;
      }
      if (tok === SyntaxKind.LessThanSlashToken) {
        let t = advance(); // closing tag: consume through `>`
        while (t !== SyntaxKind.GreaterThanToken && t !== SyntaxKind.EndOfFile) t = advance();
        return;
      }
      return; // unexpected token — bail rather than spin
    }
  };

  for (;;) {
    const tok = advance();
    if (tok === SyntaxKind.EndOfFile) break;
    if (isTsx && tok === SyntaxKind.LessThanToken && !NO_JSX_AFTER.has(prevTok)) {
      scanJsxElement();
    }
  }
  return found;
}

/** Read `file` and walk it; `rel` is computed against `srcRoot`. */
export function scanFile(file: string, srcRoot: string, includeTranslations = false): Found[] {
  return scanSource(
    readFileSync(file, 'utf8'),
    relative(srcRoot, file).replaceAll('\\', '/'),
    includeTranslations,
  );
}
