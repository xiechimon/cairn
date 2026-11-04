// Regression pins for the i18n-coverage token walk (#681). The walk scans
// every file under src/ with the TS 7 native scanner; before the fix it never
// rescanned `/` as a regex literal, so a `#` inside any regex body scanned as
// a zero-length PrivateIdentifier forever — the gate hung at ~100% CPU with
// no output (9h40m live orphan captured 2026-10-03, docs/verify/681/).
//
// Two pins per acceptance line of #681:
//   1. the historical trigger shapes terminate and scan correctly (the regex
//      is one token; findings are neither lost nor invented);
//   2. the zero-advance guard turns any *future* wedge into a loud
//      file:line:col error instead of a silent hang.

import { describe, expect, it } from 'vitest';
import { scanSource } from './i18n-scan.js';

describe('regex literals containing # (the #681 wedge)', () => {
  it('scans the historical #675 trigger without hanging and without findings', () => {
    // The exact hunk that stalled CI three times on #675/#678.
    const src = "const seq = /^#(\\d+)$/.exec(label)?.[1];\n";
    expect(scanSource(src, 'overlay/mention-token.ts')).toEqual([]);
  });

  it.each([
    ['/#/', "const a = /#/.exec('x');\n"],
    ['/^#/', 'const b = /^#/.test(s);\n'],
    ['/^#(\\d+)$/', 'const c = /^#(\\d+)$/.exec(t)?.[1];\n'],
    ['markdown-heading shape /^#+\\s*/', 'const h = /^#+\\s*/.exec(line);\n'],
  ])('terminates on %s', (_label, src) => {
    expect(scanSource(src, 'x.ts')).toEqual([]);
  });

  it('scans a regex after an if-header close paren as regex, not division', () => {
    expect(scanSource('if (a) /^#/.test(s);\nwhile (b) /#/.test(s);\n', 'x.ts')).toEqual([]);
  });

  it('scans a regex inside a JSX expression container and a template substitution', () => {
    const tsx = 'const el = <Foo re={/#/.test(v)} />;\n';
    expect(scanSource(tsx, 'x.tsx')).toEqual([]);
    const tpl = "const s = `${/#/.test(x) ? '中文' : ''}`;\n";
    expect(scanSource(tpl, 'i18n/x.ts')).toEqual([{ rel: 'i18n/x.ts', text: '中文', kind: 'literal' }]);
  });
});

describe('regex vs division disambiguation', () => {
  it('keeps division as division (no phantom regex swallowing code)', () => {
    const src = 'const q = total / count / 2;\nconst r = n++ / 2;\nconst t = arr[0] / 2;\n';
    expect(scanSource(src, 'x.ts')).toEqual([]);
  });

  it('keeps JSX self-closing tags intact after spread attributes', () => {
    // A rescan after `}` would swallow `/>` into an unterminated regex that
    // runs to EOF — everything after this element must still be scanned.
    const tsx = "const el = <Foo {...p} />;\nconst s = '中文';\n";
    expect(scanSource(tsx, 'x.tsx')).toEqual([{ rel: 'x.tsx', text: '中文', kind: 'literal' }]);
  });

  it('no longer mis-scans regex bodies as code (phantom string findings)', () => {
    // Before the fix the `'` inside the regex opened a fake string literal
    // that ran to end-of-line; the real CJK literal below must be the only
    // finding, with its exact text.
    const src = 'const re = /[\'"]/;\nconst s = \'中文\';\n';
    expect(scanSource(src, 'i18n/x.ts')).toEqual([{ rel: 'i18n/x.ts', text: '中文', kind: 'literal' }]);
  });

  it('does not flag CJK inside a regex literal body', () => {
    expect(scanSource('const re = /中文/;\n', 'x.ts')).toEqual([]);
  });
});

describe('zero-advance guard (#681 seatbelt)', () => {
  it('throws with file:line:col instead of spinning on a wedging token', () => {
    // A bare `#` outside any regex (next char cannot continue a token) is the
    // measured zero-advance shape: the scanner returns an empty
    // PrivateIdentifier at the same offset forever.
    const src = 'const x = 1;\nconst y = # ;\n';
    expect(() => scanSource(src, 'bad.ts')).toThrow(/bad\.ts:2:11/);
    expect(() => scanSource(src, 'bad.ts')).toThrow(/PrivateIdentifier/);
    expect(() => scanSource(src, 'bad.ts')).toThrow(/no progress/);
  });

  it('throws on the #( wedge shape too', () => {
    expect(() => scanSource('f(#(x));\n', 'bad2.ts')).toThrow(/bad2\.ts:1:3/);
  });
});

describe('translation call literals', () => {
  it.each([
    ["t('Projects')", 'Projects'],
    ["t?.('Projects')", 'Projects'],
    ["const el = <span>{t?.('Scheduled')}</span>", 'Scheduled'],
    ["const el = <span>{t('Scheduled')}</span>", 'Scheduled'],
    ['t(`Projects`)', 'Projects'],
    ["t('工作台')", '工作台'],
    ["t('Undo', { count: 1 })", 'Undo'],
    ["t /* gap */ ('Scheduled')", 'Scheduled'],
  ])('collects %s', (source, text) => {
    expect(scanSource(source, 'x.tsx', true).filter((item) => item.kind === 'translation')).toEqual([
      { rel: 'x.tsx', text, kind: 'translation' },
    ]);
  });

  it.each([
    "const label = 'Projects'",
    "// t('Projects')",
    "/* t('Scheduled') */",
    "other('Projects')",
    "object.t('Projects')",
    "object?.t('Projects')",
    "object.t?.('Projects')",
    't(key)',
    't(`Projects ${count}`)',
    "t('Projects' + suffix)",
    "t(prefix, 'Projects')",
  ])('ignores %s', (source) => {
    expect(scanSource(source, 'x.tsx', true).filter((item) => item.kind === 'translation')).toEqual([]);
  });
});
