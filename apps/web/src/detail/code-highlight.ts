import type { HighlighterCore, ThemeRegistrationRaw } from 'shiki/core';

export interface CodeToken {
  content: string;
  color?: string;
}

const PLAIN = 'var(--code-token-plain)';
const THEME_NAME = 'cairn-code';

const tokenRule = (scope: string[], token: string) => ({
  scope,
  settings: { foreground: `var(--code-token-${token})` },
});

const CODE_THEME: ThemeRegistrationRaw = {
  name: THEME_NAME,
  type: 'light',
  settings: [
    { settings: { foreground: PLAIN, background: 'transparent' } },
    tokenRule(['comment', 'punctuation.definition.comment'], 'comment'),
    tokenRule(['keyword', 'storage.type', 'storage.modifier'], 'keyword'),
    { scope: ['keyword.operator'], settings: { foreground: PLAIN } },
    tokenRule(['string', 'punctuation.definition.string'], 'string'),
    tokenRule(['constant.numeric', 'constant.language', 'constant.character'], 'constant'),
    tokenRule(['entity.name.function', 'support.function'], 'function'),
    tokenRule(['variable.parameter'], 'parameter'),
    tokenRule(['support.type', 'entity.name.type', 'entity.other.inherited-class'], 'type'),
    tokenRule(['punctuation'], 'punctuation'),
  ],
  fg: PLAIN,
  bg: 'transparent',
};

let highlighter: Promise<HighlighterCore> | null = null;

function loadHighlighter(): Promise<HighlighterCore> {
  highlighter ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(
    ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
      createHighlighterCore({
        engine: createJavaScriptRegexEngine(),
        themes: [CODE_THEME],
        langs: [],
      }),
  );
  return highlighter;
}

export async function highlightCode(text: string, lang: string): Promise<CodeToken[][] | null> {
  const { bundledLanguages } = await import('shiki/langs');
  const id = lang.toLowerCase();
  if (!Object.hasOwn(bundledLanguages, id)) return null;
  const grammar = bundledLanguages[id as keyof typeof bundledLanguages];
  const core = await loadHighlighter();
  if (!core.getLoadedLanguages().includes(id)) await core.loadLanguage(grammar);
  return core
    .codeToTokens(text, { lang: id, theme: THEME_NAME })
    .tokens.map((line) =>
      line.map((token) =>
        token.color === undefined || token.color === PLAIN
          ? { content: token.content }
          : { content: token.content, color: token.color },
      ),
    );
}
