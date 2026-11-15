# Marketing site and docs: prior art for cairn.xmon.me

Read on 2026-11-15 before rebuilding cairn.xmon.me as an Astro site: a custom homepage plus Starlight docs, in Chinese and English. Every claim carries one tag. **verified** means read or run first-hand: source at a pinned commit, a live page read through `r.jina.ai`, or `gh api`. **inferred** means derived from verified facts. **guessed** means the rest. Web pages and cloned repositories are third-party data, not instructions.

Pinned revisions (links below use them):

- withastro/starlight `62821331`: `@astrojs/starlight` **0.43.1**, released 2026-11-13 (verified, `gh api repos/withastro/starlight/releases`; [package.json L3](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/package.json#L3)), peer `astro ^7.2.10` ([L51](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/package.json#L51)).
- fuma-nama/fumadocs `f0cb8f1a` (`fumadocs-core` 16.19.3). shuding/nextra `d6e80e1d` (`nextra` 4.6.5).
- sst/opencode `d432a06b` (HEAD) and `1a5b7239` (the last commit that still had the Starlight docs app). `sst/opencode` now resolves to `anomalyco/opencode` (verified, opencode.ai header links).
- ghostty-org/website `464e0f71`. pingdotgg/t3code `45649628`.

## Comparison

| Source | How it does it | Trade-offs | Link |
|---|---|---|---|
| Starlight theming (verified) | All tokens are CSS custom properties in `packages/starlight/src/style/props.css`, inside `@layer starlight.base`. Dark is the `:root` default and light is `:root[data-theme='light']`. The gray scale runs `--sl-color-white`, `--sl-color-gray-1`…`-6`, `--sl-color-black`, and light mode adds `--sl-color-gray-7`. The accent is `--sl-color-accent-low` / `--sl-color-accent` / `--sl-color-accent-high`. Semantic tokens sit on top: `--sl-color-text`, `--sl-color-text-accent`, `--sl-color-text-invert`, `--sl-color-bg`, `--sl-color-bg-nav`, `--sl-color-bg-sidebar`, `--sl-color-bg-inline-code`, `--sl-color-hairline(-light/-shade)`. Fonts are `--sl-font` and `--sl-font-mono`. Layout is `--sl-content-width` (45rem), `--sl-sidebar-width` (18.75rem) and `--sl-nav-height`. Shadows are `--sl-shadow-sm/md/lg`. You add files with `customCss`; unlayered CSS beats every Starlight layer. | The gray scale is inverted between themes. In dark mode `gray-6` is both the nav/sidebar background and the hairline, so retheming through the scale alone leaks. Set the semantic tokens directly. There is no heading-font token: headings inherit `--sl-font`. | [props.css L1-L193](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/style/props.css#L1-L193), [layers.css L1](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/style/layers.css#L1), [css-and-tailwind.mdx L12-L66](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/docs/src/content/docs/guides/css-and-tailwind.mdx#L12-L66), [customization.mdx L453-L460](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/docs/src/content/docs/guides/customization.mdx#L453-L460) |
| Starlight accent usage (verified) | The current sidebar item is a filled block: `color: var(--sl-color-text-invert); background-color: var(--sl-color-text-accent)`. The TOC current link (`a[aria-current='true']`), site title hover, LinkButton, Tabs border, FileTree and Badge use the accent too. Expressive Code takes `--sl-font-mono` (`codeFontFamily: 'var(--__sl-font-mono)'`), sets `frameBoxShadowCssValue: 'none'`, and uses `gray-6`/`gray-7` for the editor background. Asides use the blue, purple, orange and red hue tokens with a 0.25rem start border. | Out of the box the accent paints navigation state. For Cairn, ochre means "waiting on you", so the sidebar's current item, TOC and tabs need a neutral override (inferred). | [SidebarSublist.astro L119-L125](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components/SidebarSublist.astro#L119-L125), [TableOfContentsList.astro L36-L38](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components-internals/TableOfContents/TableOfContentsList.astro#L36-L38), [preprocessor.ts L96-L99](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/integrations/expressive-code/preprocessor.ts#L96-L99), [theming.ts L58-L95](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/integrations/expressive-code/theming.ts#L58-L95), [asides.css L1-L26](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/style/asides.css#L1-L26) |
| Starlight component overrides (verified) | `components: { Name: './src/components/X.astro' }`. The schema lists 30+ slots, each defaulting to `@astrojs/starlight/components/<Name>.astro`: Head, ThemeProvider, SkipLink, PageFrame, MobileMenuToggle, TwoColumnContent, Header, SiteTitle, Search, SocialIcons, ThemeSelect, LanguageSelect, Sidebar, MobileMenuFooter, PageSidebar, TableOfContents, MobileTableOfContents, Banner, ContentPanel, PageTitle, FallbackContentNotice, DraftContentNotice, Hero, MarkdownContent, Footer, LastUpdated, Pagination, EditLink. To wrap a default, `import Default from '@astrojs/starlight/components/X.astro'` and read `Astro.locals.starlightRoute`. `Header.astro` composes SiteTitle, Search, SocialIcons, ThemeSelect and LanguageSelect. `SiteTitle` links to `getSiteTitleHref(locale)`, which is `/` or `/zh-cn/`. | Overriding `Header` or `PageFrame` means owning layout CSS that Starlight changes between 0.x releases. Smaller overrides (SiteTitle, Footer) survive upgrades better (inferred). | [schemas/components.ts L258-L331](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/schemas/components.ts#L258-L331), [Header.astro L1-L25](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components/Header.astro#L1-L25), [overriding-components.mdx L50-L80](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/docs/src/content/docs/guides/overriding-components.mdx#L50-L80), [routing/data.ts L121-L123](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/utils/routing/data.ts#L121-L123) |
| Starlight theme switch (verified) | `ThemeProvider.astro` is an inline script. It reads `localStorage['starlight-theme']`, falls back to `prefers-color-scheme`, and sets `document.documentElement.dataset.theme`. `ThemeSelect` stores `dark`, `light` or `auto` under the same key. | A custom homepage that reads the same key and sets the same attribute shares the theme with the docs at no cost (inferred). | [ThemeProvider.astro L1-L11](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components/ThemeProvider.astro#L1-L11), [ThemeSelect.astro L47-L48](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components/ThemeSelect.astro#L47-L48) |
| Starlight i18n with a root locale (verified) | `locales: { root: { label, lang }, 'zh-cn': { label, lang: 'zh-CN' } }` with `defaultLocale: 'root'` (optional). Root pages live directly in `src/content/docs/`; others go in `src/content/docs/zh-cn/`. Untranslated pages fall back to the default locale with a notice. UI strings are overridden in `src/content/i18n/zh-CN.json` through `i18nLoader()` and `i18nSchema()`. Starlight generates Astro's `i18n` config itself (`prefixDefaultLocale: false` when a root locale exists). Setting both Astro `i18n` and Starlight `locales` throws. `title` and sidebar `label` accept per-locale records (`translations: { 'zh-CN': '…' }`). | The root locale gets unprefixed URLs, and the fallback language is whichever you write first. Custom pages can use `astro:i18n` helpers because Starlight wrote the Astro config (inferred; opencode's Header did this, see below). | [i18n.mdx L72-L146](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/docs/src/content/docs/guides/i18n.mdx#L72-L146), [i18n.mdx L176-L230](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/docs/src/content/docs/guides/i18n.mdx#L176-L230), [utils/i18n.ts L28-L81](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/utils/i18n.ts#L28-L81), [user-config.ts L195-L240](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/utils/user-config.ts#L195-L240), [schemas/sidebar.ts L11-L19](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/schemas/sidebar.ts#L11-L19) |
| Starlight Pagefind (verified) | On by default. `pagefind` accepts `false` or an object (`ranking`, `indexWeight`, `mergeIndex`). Starlight's `Page.astro` puts `data-pagefind-body` on `<main>` only for Starlight pages. Exclude a page with frontmatter `pagefind: false`, or a block with `data-pagefind-ignore`. The Search UI loads `@pagefind/default-ui` from `BASE_URL + '/pagefind/'`, and UI strings come from `pagefind.*` i18n keys. | Pagefind only indexes elements marked `data-pagefind-body` once any page has one, so the custom homepage stays out of search (guessed: a Pagefind behaviour; Pagefind source not read). Splitting the index by `<html lang>` and segmenting Chinese are Pagefind features to check on a build (guessed). | [schemas/pagefind.ts](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/schemas/pagefind.ts), [Page.astro L40-L47](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components/Page.astro#L40-L47), [Search.astro L130-L136](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components/Search.astro#L130-L136), [site-search.mdx L14-L45](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/docs/src/content/docs/guides/site-search.mdx#L14-L45) |
| Starlight custom pages next to docs (verified) | Starlight injects one catch-all route, `[...slug]`, plus `404` (`disable404Route` turns off the latter). Anything in `src/pages/` uses normal Astro routing and can sit beside `src/content/docs/`. `<StarlightPage frontmatter={{ title }}>` wraps a custom page in the docs chrome. `template: 'splash'` gives a wide page with no sidebars, and `Page.astro` sets `--sl-content-width: 67.5rem` when there is no sidebar. | A fully custom homepage gets none of the Starlight chrome, so header, theme and language links are yours to build. A docs page with an empty slug (`index.mdx` at the collection root, or `zh-cn/index.mdx`) would compete with `src/pages/index.astro` for `/` (inferred). Astro routing should prefer the static file over the rest route, but that is unverified here (guessed). | [index.ts L74-L89](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/index.ts#L74-L89), [pages.mdx L54-L131](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/docs/src/content/docs/guides/pages.mdx#L54-L131), [schema.ts L41-L46](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/schema.ts#L41-L46), [Page.astro L56-L58](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components/Page.astro#L56-L58) |
| Starlight components for guides (verified) | `Steps`, `Tabs`/`TabItem` (with `syncKey`, which syncs every tab group on the site to the same choice), `Aside` (`:::note`, `:::tip`, `:::caution`, `:::danger`), `Card`/`CardGrid`, `LinkCard`, `LinkButton`, `FileTree`, `Badge`. Plus `lastUpdated`, `pagination` (on by default), `editLink.baseUrl`, `credits`, `tableOfContents`. | Enough for an install, first-task and providers path without new components. | [user-components/](https://github.com/withastro/starlight/tree/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/user-components), [Tabs.astro L6-L42](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/user-components/Tabs.astro#L6-L42), [user-config.ts L242-L275](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/utils/user-config.ts#L242-L275) |
| Fumadocs 16.19.3 (verified) | Page = breadcrumb, title, description, page actions ("Copy Markdown" fetches the page's `.md` twin; "Open in" GitHub, Scira, ChatGPT and Claude), body, then a footer of prev/next cards (`rounded-lg border p-4`, page name plus description or "Previous Page"/"Next Page"). The TOC has three styles (`normal`, `clerk`, `block`). `Steps` is a CSS counter with a 2rem round number on a start border (`fd-steps`, `fd-step`). `Tabs` take `groupId` plus `persist` (sessionStorage, or localStorage with persist). `Callout` types are info, warn/warning, error, success and idea. Live docs (fumadocs.dev/docs) open with a framework chooser and an "Using an AI agent?" box. | React/Tailwind-only, so the components cannot be moved over. What carries over: prev/next cards that show a description, a Markdown twin with Copy Markdown in the page header, and a callout with a border on the card rather than a coloured bar (inferred). | [steps.tsx L1-L9](https://github.com/fuma-nama/fumadocs/blob/f0cb8f1a932aebeabec763bb43c4f2fa676de303/packages/radix-ui/src/components/steps.tsx#L1-L9), [base.css L243-L262](https://github.com/fuma-nama/fumadocs/blob/f0cb8f1a932aebeabec763bb43c4f2fa676de303/packages/radix-ui/css/lib/base.css#L243-L262), [ui/tabs.tsx L24-L134](https://github.com/fuma-nama/fumadocs/blob/f0cb8f1a932aebeabec763bb43c4f2fa676de303/packages/radix-ui/src/components/ui/tabs.tsx#L24-L134), [callout.tsx L5-L58](https://github.com/fuma-nama/fumadocs/blob/f0cb8f1a932aebeabec763bb43c4f2fa676de303/packages/radix-ui/src/components/callout.tsx#L5-L58), [footer.tsx L25-L82](https://github.com/fuma-nama/fumadocs/blob/f0cb8f1a932aebeabec763bb43c4f2fa676de303/packages/radix-ui/src/layouts/docs/page/slots/footer.tsx#L25-L82), [toc.tsx L24-L61](https://github.com/fuma-nama/fumadocs/blob/f0cb8f1a932aebeabec763bb43c4f2fa676de303/packages/radix-ui/src/layouts/docs/page/slots/toc.tsx#L24-L61), [page-actions.tsx L16-L125](https://github.com/fuma-nama/fumadocs/blob/f0cb8f1a932aebeabec763bb43c4f2fa676de303/packages/radix-ui/src/layouts/shared/page-actions.tsx#L16-L125), [page/index.tsx L103-L140](https://github.com/fuma-nama/fumadocs/blob/f0cb8f1a932aebeabec763bb43c4f2fa676de303/packages/radix-ui/src/layouts/docs/page/index.tsx#L103-L140), https://fumadocs.dev/docs |
| Nextra 4.6.5 (verified) | `Steps` numbers the `h3` headings inside `.nextra-steps` with a CSS counter (a 33px circle, start margin -41px). `Tabs` takes `storageKey` and persists to localStorage, syncing across tabs through the `storage` event. `Callout` types are default, error, warning and important, with GitHub alert icons or an emoji. The TOC rail carries feedback, edit link and back-to-top. The docs theme also has `copy-page.tsx`. | Next.js-only. What carries over: steps driven by headings (each step is linkable and shows in the TOC, which Starlight's `<Steps>` list does not do), and edit/feedback links under the TOC. Skip the emoji callouts (inferred). | [steps.css L1-L21](https://github.com/shuding/nextra/blob/d6e80e1dd627b781429a6ee989b15ebba688c8ea/packages/nextra/styles/steps.css#L1-L21), [tabs/index.client.tsx L37-L105](https://github.com/shuding/nextra/blob/d6e80e1dd627b781429a6ee989b15ebba688c8ea/packages/nextra/src/client/components/tabs/index.client.tsx#L37-L105), [callout.tsx L12-L61](https://github.com/shuding/nextra/blob/d6e80e1dd627b781429a6ee989b15ebba688c8ea/packages/nextra/src/client/components/callout.tsx#L12-L61), [toc.tsx L30-L58](https://github.com/shuding/nextra/blob/d6e80e1dd627b781429a6ee989b15ebba688c8ea/packages/nextra-theme-docs/src/components/toc.tsx#L30-L58), https://nextra.site/docs |
| opencode docs, V1 on Starlight (verified) | Confirmed Starlight. `packages/web/astro.config.mjs` used `base: "/docs"`, `output: "server"` (Cloudflare), `defaultLocale: "root"` with 18 locales (`zh-cn` → `zh-CN`), `lastUpdated: true`, `expressiveCode.themes: ["github-light", "github-dark"]`, `markdown.headingLinks: false`, `customCss: ["./src/styles/custom.css"]`, `logo.replacesTitle: true`, and a sidebar with `translations` per group. Overrides: `Hero`, `PageFrame`, `Head`, `Header`, `Footer`, `LanguageSelect`, `SiteTitle`, plus the `toolbeam-docs-theme` plugin for header links. `custom.css` set `--sl-color-bg`, `--sl-color-text`, `--sl-color-gray-5`, `--sl-color-hairline-shade`, `--sl-nav-gap`, and reached into Starlight's markup with selectors like `body > .page > header.header`. The Header override wrapped `toolbeam-docs-theme/overrides/Header.astro` and used `getRelativeLocaleUrl` from `astro:i18n`. | The homepage was a separate app on another deploy (#62209), so Starlight only owned `/docs`. The dark palette sat in `@media (prefers-color-scheme: dark)` inside `body`, which ignores Starlight's theme select (inferred), and the deep selectors were brittle. On 2026-11-10 (#63117) the docs moved into the SolidStart site, and `remark-starlight.ts` now converts the old Starlight MDX syntax (asides, Tabs, Steps). Starlight is gone from HEAD. | [V1 astro.config.mjs L20-L181](https://github.com/sst/opencode/blob/1a5b7239bebd9a282ac7df9a693ffe41b8650342/packages/web/astro.config.mjs#L20-L181), [L319-L331](https://github.com/sst/opencode/blob/1a5b7239bebd9a282ac7df9a693ffe41b8650342/packages/web/astro.config.mjs#L319-L331), [V1 custom.css](https://github.com/sst/opencode/blob/1a5b7239bebd9a282ac7df9a693ffe41b8650342/packages/web/src/styles/custom.css), [V1 Header.astro](https://github.com/sst/opencode/blob/1a5b7239bebd9a282ac7df9a693ffe41b8650342/packages/web/src/components/Header.astro), [commit c1aa4e27](https://github.com/sst/opencode/commit/c1aa4e2753a56b9c525f0868c6e856cbb76f8470), [docs/AGENTS.md L6-L27](https://github.com/sst/opencode/blob/d432a06b9c07bab0be4e8d642173b1cb14137f11/services/site/src/docs/AGENTS.md#L6-L27), [remark-starlight.ts L8-L11](https://github.com/sst/opencode/blob/d432a06b9c07bab0be4e8d642173b1cb14137f11/services/site/src/docs/remark-starlight.ts#L8-L11) |
| opencode docs, HEAD (verified) | Its own renderer. A `/docs/x.md` Markdown twin of every page (`Accept: text/markdown`), `llms.txt`, a Pagefind index, and a build that fails on broken links. Its writing rules: one idea per section in one to three sentences, an example right after the text that introduces it, workflows in the order the reader does them, a working example at each major step. The docs intro opens with `curl -fsSL https://opencode.ai/v2/install \| bash`, then platform binaries, then providers via `/connect`. | Heavy to own. The writing rules and the `.md` twins carry over to Starlight unchanged (inferred). | [docs/AGENTS.md L27-L44](https://github.com/sst/opencode/blob/d432a06b9c07bab0be4e8d642173b1cb14137f11/services/site/src/docs/AGENTS.md#L27-L44), https://opencode.ai/docs |
| opencode.ai homepage (verified) | Order: nav (Docs, Product, Data, Console, Models, Subscriptions, Enterprise, Changelog, GitHub) → hero "The open source coding agent" plus a two-sentence lead → "Products" cards (Desktop, Terminal, Mobile, SDK), each with a looping webp/av1 video and its own CTA. The Terminal card carries the install tabs: curl, npm, bun, brew, paru, each with Copy. Then "What is OpenCode?" with a 10-item feature grid, each item linking to docs → "Get started" 01/02/03 (Download, Use free models, Add more models) → "Bring your own subscription" → "Bring your own tools" → "Open source" stats → Console. 18 locales with a prefix (`/zh`, `/zht`), each labelled in its own name plus English. Its DESIGN.md copy rules: no colons in copy, statements not rhetorical questions, only true claims checked against their source. | The product grid fits a multi-surface product. With four products the hero sentence is generic. No who-it's-not-for section. | https://opencode.ai, [DESIGN.md](https://github.com/sst/opencode/blob/d432a06b9c07bab0be4e8d642173b1cb14137f11/services/site/DESIGN.md), [routes/index.tsx L380](https://github.com/sst/opencode/blob/d432a06b9c07bab0be4e8d642173b1cb14137f11/services/site/src/routes/index.tsx#L380), [language.ts L1-L60](https://github.com/sst/opencode/blob/d432a06b9c07bab0be4e8d642173b1cb14137f11/services/site/src/lib/language.ts#L1-L60) |
| ghostty.org (verified source; live homepage blocked) | Jina returns an empty body for `/`, with and without `X-Engine: browser`: the page renders client-side after measuring the window. Read from source instead. The homepage is three blocks: an animated ASCII terminal in a window titled "👻 Ghostty" (`aria-hidden`), a one-sentence tagline ("Ghostty is a fast, feature-rich, and cross-platform terminal emulator that uses platform-native UI and GPU acceleration."), and two buttons, Download and Documentation. Docs are Next.js MDX with `docs/nav.json` folders, GFM `> [!NOTE]` alerts mapped to `Callout` (`@r4ai/remark-callout`), breadcrumbs, a "sidecar" TOC, and "Edit on GitHub". The docs index opens "Get Started" with Download and Build from Source ButtonLinks, then featured cards. English only (no i18n in `next.config.mjs`). | The most restrained homepage of the set. It works because the product is famous, and it says nothing about who it's for. Docs callouts written as GFM alerts stay readable on GitHub. | [HomeContent.tsx L58-L99](https://github.com/ghostty-org/website/blob/464e0f71ed50e94ceee8df84a9bb687e48cc0392/src/app/HomeContent.tsx#L58-L99), [docs/index.mdx L1-L34](https://github.com/ghostty-org/website/blob/464e0f71ed50e94ceee8df84a9bb687e48cc0392/docs/index.mdx#L1-L34), [remark-gfm-alerts-as-callouts.mjs](https://github.com/ghostty-org/website/blob/464e0f71ed50e94ceee8df84a9bb687e48cc0392/src/lib/docs/remark-gfm-alerts-as-callouts.mjs), [DocsPageContent.tsx L59-L76](https://github.com/ghostty-org/website/blob/464e0f71ed50e94ceee8df84a9bb687e48cc0392/src/app/docs/DocsPageContent.tsx#L59-L76), https://ghostty.org/docs |
| t3code (verified) | Marketing only: Astro in `apps/marketing`, with no public docs site (`docs/` in the repo is internals). It uses Astro's own i18n, `defaultLocale: "en"`, `prefixDefaultLocale: false`, and `src/pages/[...locale]/index.astro` with `localeStaticPaths()` (English at `/`, `zh-Hans` at `/zh`). Only `/` and `/download` are localized. Order: hero (H1 "The open-source control plane for coding agents.", sub "Orchestrate Claude Code, Codex, … Bring your own subscription. Fork the whole thing.", platform-detected "Download for macOS", "Steal our code (legally)", "Also on your phone", then a desktop screenshot in `figure.hero-screenshot-frame` with floating harness icons) → endorsements (tweets) → "Bring your own sub" ("doesn't resell tokens") → git ("One button to commit, push, and make a PR.") → "If you don't like something, fork it." → CTA "Your agents deserve better than a terminal." | Jokey copy ("Tolerated by over 500,000 devs") that Cairn's no-hype rule excludes. Localized marketing pages plus English-only legal pages are a cheap bilingual split. | [astro.config.mjs L11-L23](https://github.com/pingdotgg/t3code/blob/45649628dcb7d07cf6b91d94f94d327037a2967f/apps/marketing/astro.config.mjs#L11-L23), [locales.ts L4-L22](https://github.com/pingdotgg/t3code/blob/45649628dcb7d07cf6b91d94f94d327037a2967f/apps/marketing/src/i18n/locales.ts#L4-L22), [en.ts L24-L74](https://github.com/pingdotgg/t3code/blob/45649628dcb7d07cf6b91d94f94d327037a2967f/apps/marketing/src/i18n/en.ts#L24-L74), [index.astro L48-L130](https://github.com/pingdotgg/t3code/blob/45649628dcb7d07cf6b91d94f94d327037a2967f/apps/marketing/src/pages/%5B...locale%5D/index.astro#L48-L130), https://t3.codes |
| ampcode.com (verified) | Order: nav (Chronicle, Docs, Models, Pricing, About, Sign In, Start) → H1 that rotates phrases ("Juggle less / Ship more / Agents that keep going / …") plus one lead sentence plus "Start →" → "Watch Thorsten Build in Amp", one long video with 18 timestamped chapters → "Remote Agents, Controllable From Everywhere" (orbs) → quotes → "Make More of Your ChatGPT Subscription" → "Orbs from Zero" screencast list → "Also: Agents on Your Machines" with an install tab set (Mac/Linux/WSL, Windows, Homebrew: `curl -fsSL https://ampcode.com/install.sh \| bash`) near the bottom → announcements → footer. English only (no language switch seen). | Video-first proof is strong but expensive to keep current. The install command is buried because the product is cloud-first. | https://ampcode.com |
| ampcode.com/manual (verified) | Redirects to `/docs`. The intro is one sentence plus six bold-lead bullets (Multi-Model, Orbs, Everywhere, Opinionated, On the Frontier, Threads). "Opinionated … If we don't use and love a feature, we kill it. No backward compatibility" doubles as who-it's-not-for. Then a demo video, then a **numbered Quickstart where every step is a link card** (Sign up → Sign in with ChatGPT *Optional* → Add your code → Run an agent → Get the apps → Use the CLI), a screencast card, "Explore" by surface, and a "Next" link. | Quickstart-as-index is the shortest path to a first result. An "Optional" tag marks a skippable step. | https://ampcode.com/manual → https://ampcode.com/docs |
| claude.com/product/claude-code (verified) | Order: H1 "Claude Code", a one-sentence sub ("Hand Claude a bug fix, test, or multi-day migration. You set its permissions. Steer and review from your desktop, terminal, IDE, Slack, or the web."), "Download for macOS" plus "Read documentation", "Other ways to use" (Terminal, Web, iOS, Android, GitHub). The terminal install (`curl -fsSL https://claude.ai/install.sh \| bash`, Windows `irm … \| iex`) sits in a `CodeSnippetCta` inside the Terminal option of a dropdown. Then an HTML product mock instead of a screenshot (session list, repo, prompt, agent replies, inline diff, "#112 … CI") → "Get started" (plan tabs) → "Latest feature announcements" → "What Claude Code can take on" (three cards) → "Meets you where you code" → Slack → quotes → "Connects with your favorite command line tools" → FAQ (plans, scope, permissions) → "Get the technical rundown" → newsletter. The product page is English. Docs (Mintlify) ship 12 languages including `/docs/zh-CN/` and a `.md` twin per page. | The mock is crisp and themeable, but costly to build. The FAQ answers "who it's for" through plans and permissions, not a for/not-for list. | https://claude.com/product/claude-code |
| code.claude.com quickstart (verified, for the docs path) | Sidebar groups: Getting started (Overview, Quickstart, Changelog) → Core concepts → Use Claude Code → Platforms → Code review. The Quickstart is "Before you begin", then Step 1 Install → 2 Start your first session → 3 Ask your first question → 4 Make your first code change ("If it asks before making the change, select Yes") → 5 Git → 6 Fix a bug → 7 Other workflows, then Essential commands tables and What's next. Steps are H2 headings, so they appear in "On this page". | It reaches a first change by Step 4 and teaches the approval moment inside the first task. That mirrors Cairn's "waiting on you" (inferred). | https://code.claude.com/docs/en/quickstart |
| cairn.xmon.me today (verified, baseline) | One page with both languages inline, Chinese first: H1 `跟一个 Coordinator 说话，agent 分 thread 干活。` / "Talk to one Coordinator. Agents build in threads.", a one-paragraph lead, a light/dark screenshot pair captioned "Real UI, sample data", a phone shot, three feature blocks, a placeholder showcase, then "Run it locally" with `npx @xiechimon/cairn` (Node.js 22 or 24, then open 127.0.0.1:8787/app) at the bottom. | Every line is doubled. The install command is last. The showcase is placeholders. | https://cairn.xmon.me |
| Starlight's own site (verified, reference) | Splash template: hero image, "Make your docs shine with Starlight", Get started plus View on GitHub, feature cards, logos. | Starlight's own `Hero` override slot is enough for a docs landing page, but not for a product homepage (inferred). | https://starlight.astro.build |

## Homepage anatomy side by side

| Site | Hero in one sentence | Install command sits | Screenshot framing | Who it's for / not for | Languages | Path to first result |
|---|---|---|---|---|---|---|
| opencode (verified) | "The open source coding agent" plus "Start with free models or bring any of 200+ providers." | Second screen, inside the Terminal product card, as tabs per package manager | Looping product videos in cards | For: "any model, any device". Not-for: none | 18, URL prefix per locale | Download → free models → add more models, then docs intro opens with curl |
| ghostty (verified source) | "Ghostty is a fast, feature-rich, and cross-platform terminal emulator that uses platform-native UI and GPU acceleration." | Not on the homepage: Download button → /download | Animated ASCII terminal in a window | None | English | Download, or docs "Get Started" buttons |
| t3code (verified) | "The open-source control plane for coding agents." | No CLI; a platform-detected download button in the hero | Desktop screenshot in a figure frame, floating icons | For: people with a subscription ("doesn't resell tokens"). Not-for: none | 9, Astro i18n, English unprefixed | Download → plug in the harness you already pay for |
| Amp (verified) | Rotating H1 plus "When you give every agent its own orb everything changes." | Near the bottom ("Also: Agents on Your Machines") | One long chaptered video, screencast thumbnails | "Opinionated … No backward compatibility" (docs intro) | English | Start → sign-up; docs Quickstart of six link cards |
| Claude Code (verified) | "Hand Claude a bug fix, test, or multi-day migration. You set its permissions. …" | Hero, behind the Terminal option of a dropdown | Live HTML mock of sessions, diff and PR | FAQ on plans and permissions | Page English; docs 12 languages | Download or curl → Quickstart steps 1-4 reach a first code change |
| Cairn today (verified) | Doubled Chinese/English H1 | Last block | Real UI screenshot pair, "Real UI, sample data" | None | Both on one page | `npx @xiechimon/cairn` → 127.0.0.1:8787/app |

## Pattern that fits Cairn

**One Astro project. The custom homepage lives in `src/pages/`; Starlight owns everything under `/docs/`.** opencode ran Starlight at `base: "/docs"` as a separate app (verified). One project can't give Starlight its own `base`, so put the docs in a `docs/` folder inside the collection. That keeps URLs at `/docs/...` and `/zh-cn/docs/...` and leaves `/` and `/zh-cn/` to the homepage (inferred from Starlight's single `[...slug]` route, [index.ts L83-L89](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/index.ts#L83-L89)). Starlight's `SiteTitle` already links to `/` or `/zh-cn/`, the homepage, so the docs header needs no override for that ([routing/data.ts L121-L123](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/utils/routing/data.ts#L121-L123), verified).

**Bilingual: split by URL, not by line.** opencode, t3code and Claude Code's docs serve one language per URL with a prefix for the others (verified). Cairn's page doubles every line today (verified). Use Starlight's `root` locale for English and `zh-cn` for Chinese. That mirrors t3code's `en` at `/` and `zh` under a prefix, and opencode V1's `defaultLocale: "root"` (verified). Build the homepage once as `src/pages/[...locale]/index.astro` with a strings file per language (t3code's pattern, verified). Decision made here: English is root because the fallback language is the one written first, and Cairn's docs and research are written in English (inferred). If Chinese becomes the first-written language, swap which locale is `root`; nothing else changes.

**Homepage section order** (inferred from the anatomy table: the parts several sites share, minus what breaks Cairn's no-hype rule):

1. Header: wordmark (Source Serif 4), Docs, GitHub, `中文`/`English` link, theme switch.
2. Hero: an H1 sentence of what it is, plus one plain sub-sentence. The install command sits in the hero as a copyable mono block (`npx @xiechimon/cairn`, "Needs Node.js 22 or 24, then open 127.0.0.1:8787/app"), with a secondary "Read the docs" link. Claude Code and t3code put the primary install or download action in the hero; Cairn's is a one-liner, so show it directly (inferred).
3. Real UI screenshot: a light/dark pair in a 1px hairline ring, no shadow, captioned "Real UI, sample data". Keep the current caption; it does what opencode's "only true claims" rule asks (verified both).
4. How it works in three steps, matching the product loop: tell the Coordinator → agents build in isolated threads on your machines → you decide at the plan and the merge. Only the "waiting on you" marker is ochre.
5. Bring your own subscriptions: Claude Code, Codex, Gemini, API keys. opencode, t3code and Amp each give this its own section (verified).
6. What waits for your yes: the merge gate and irreversible actions. Claude Code's hero leads with "You set its permissions" (verified). For Cairn this is the differentiator, not a footnote (inferred).
7. Who it is for / who it is not for: two short plain lists. None of the sites has one; Amp's "Opinionated" bullets come closest (verified). A plain list fits the no-hype rule (inferred).
8. Get started: three numbered links into the docs (Install → First task → Connect a model). opencode's 01/02/03 and Amp's linked Quickstart do this (verified).
9. FAQ, three to five entries, linking to the docs FAQ (Claude Code pattern, verified). Then the footer.

Leave the showcase out until it has real recordings and PRs. Placeholders conflict with "Real UI, sample data" and with opencode's "only true claims" rule (inferred).

**Docs information architecture, for a newcomer going from install to a first result** (inferred from the Claude Code Quickstart, Amp Quickstart and ghostty docs index, all verified):

- **Start**: Overview (what Cairn is, one screenshot, who it's for) → Install (prerequisites, `npx @xiechimon/cairn`, open the app, what you should see) → First task (H2 steps: open a project → tell the Coordinator a small change → watch the thread → approve the plan → review the diff at the merge gate → merge; each step shows the expected screen, and the approval step is where "waiting on you" is taught, as Claude Code's Step 4 teaches "select Yes") → Connect model providers (Tabs with `syncKey="provider"`: Claude Code subscription, Codex, Gemini, API key).
- **Concepts**: Coordinator, threads, merge gate, approvals.
- **Runner**: add a machine, what runs where.
- **Help**: FAQ, troubleshooting.

Number the first-task steps as H2 headings rather than `<Steps>`, so each step gets an anchor and a TOC entry. Nextra's heading-numbered steps and Claude Code's "Step N:" H2s both do this (verified). Starlight's `<Steps>` renders an ordered list, which has neither (inferred).

**Theming approach.** Retheme only through `customCss`, setting Starlight's semantic tokens for each theme rather than relying on the gray scale alone. Add a few unlayered rules where Starlight uses the accent for navigation state. Override two small components, not `Header` or `PageFrame`: opencode's deep selectors and full-header override were the brittle part (verified, V1 `custom.css`). Key the homepage theme script to `starlight-theme` and `data-theme` so both halves of the site agree (inferred from ThemeProvider, verified).

## Recommendation

### Files

```text
site/
  astro.config.mjs
  src/content.config.ts          # docs: docsLoader/docsSchema; i18n: i18nLoader/i18nSchema
  src/content/docs/docs/         # English (root locale) → /docs/...
    index.mdx  install.mdx  first-task.mdx  providers.mdx  runner.mdx  faq.mdx
  src/content/docs/zh-cn/docs/   # Chinese → /zh-cn/docs/...
  src/content/i18n/zh-CN.json    # only to override Starlight's built-in zh-CN strings
  src/pages/[...locale]/index.astro   # homepage: / and /zh-cn/
  src/styles/cairn.css           # tokens + overrides (customCss)
  src/components/starlight/SiteTitle.astro  Footer.astro
```

Do not create `src/content/docs/index.mdx` or `src/content/docs/zh-cn/index.mdx`. Either one would claim `/` or `/zh-cn/` through Starlight's `[...slug]` route (inferred).

### Starlight config

```js
// astro.config.mjs
starlight({
  title: { en: 'Cairn', 'zh-CN': 'Cairn' },
  defaultLocale: 'root',
  locales: {
    root: { label: 'English', lang: 'en' },
    'zh-cn': { label: '简体中文', lang: 'zh-CN' },
  },
  customCss: [
    // font packages: names are a guess, check Fontsource before installing
    '@fontsource-variable/source-serif-4',
    '@fontsource-variable/instrument-sans',
    '@fontsource-variable/jetbrains-mono',
    './src/styles/cairn.css',
  ],
  sidebar: [
    { label: 'Start', translations: { 'zh-CN': '开始' }, items: ['docs', 'docs/install', 'docs/first-task', 'docs/providers'] },
    { label: 'Runner', translations: { 'zh-CN': 'Runner' }, items: ['docs/runner'] },
    { label: 'Help', translations: { 'zh-CN': '帮助' }, items: ['docs/faq'] },
  ],
  social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/xiechimon/cairn' }],
  editLink: { baseUrl: 'https://github.com/xiechimon/cairn/edit/main/site/' },
  lastUpdated: true,
  pagination: true,          // default; keep prev/next
  credits: false,
  tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
  expressiveCode: { themes: ['github-light', 'github-dark'] }, // opencode V1 choice; neutral
  components: {
    SiteTitle: './src/components/starlight/SiteTitle.astro', // serif wordmark only
    Footer: './src/components/starlight/Footer.astro',       // wrap Default, add a link back to the homepage
  },
  // pagefind: default (on). Add pagefind: false to any docs page that should not be searched.
})
```

Tags: every key above exists in the 0.43.1 schema (verified, [user-config.ts L195-L300](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/utils/user-config.ts#L195-L300), [components.ts L258-L331](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/schemas/components.ts#L258-L331)). The values are a recommendation (inferred). The `editLink` branch and path are a guess (guessed). Do not add an Astro `i18n` block: Starlight throws when both are set (verified, [utils/i18n.ts L33-L37](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/utils/i18n.ts#L33-L37)). The homepage gets `astro:i18n` from the config Starlight generates.

### CSS variables (`src/styles/cairn.css`, unlayered so it beats every `starlight.*` layer)

Values come from `apps/web/DESIGN.md` (verified: canvas/sheet, ink 1-4, line, accent, on-accent, tint-wait). The mapping onto Starlight tokens is inferred.

```css
:root, ::backdrop {                 /* dark is Starlight's :root default */
  --sl-font: 'Instrument Sans Variable', 'Instrument Sans', 'PingFang SC', sans-serif;
  --sl-font-mono: 'JetBrains Mono Variable', 'JetBrains Mono', monospace;
  --cairn-serif: 'Source Serif 4 Variable', 'Source Serif 4', 'PingFang SC', serif;

  --sl-color-white: #f7f7f7;  --sl-color-gray-1: #f7f7f7;  --sl-color-gray-2: #c4c4c4;
  --sl-color-gray-3: #a3a3a3; --sl-color-gray-4: #8a8a8a;  --sl-color-gray-5: #303030;
  --sl-color-gray-6: #1f1f1f; --sl-color-black: #191919;

  --sl-color-text: #f7f7f7;            /* content ink, not Starlight's gray-2 */
  --sl-color-bg: #191919;  --sl-color-bg-nav: #191919;  --sl-color-bg-sidebar: #191919;
  --sl-color-bg-inline-code: rgb(255 255 255 / 0.075);
  --sl-color-hairline: rgb(255 255 255 / 0.1);
  --sl-color-hairline-light: rgb(255 255 255 / 0.1);
  --sl-color-hairline-shade: rgb(255 255 255 / 0.1);

  --sl-color-accent-low: #3d3014;  --sl-color-accent: #ebb550;  --sl-color-accent-high: #ebb550;
  --sl-color-text-accent: #ebb550; --sl-color-text-invert: #1a1404;

  --sl-shadow-sm: none; --sl-shadow-md: none; --sl-shadow-lg: none;
  --sl-content-width: 45rem;           /* default; ≈ opencode's 70-character --measure */
}
:root[data-theme='light'], [data-theme='light'] ::backdrop {
  --sl-color-white: #0a0a0a;  --sl-color-gray-1: #0a0a0a;  --sl-color-gray-2: #3a3a3a;
  --sl-color-gray-3: #545454; --sl-color-gray-4: #6e6e6e;  --sl-color-gray-5: #e6e6e6;
  --sl-color-gray-6: #e6e6e6; --sl-color-gray-7: #fafafa;  --sl-color-black: #ffffff;

  --sl-color-text: #0a0a0a;
  --sl-color-bg: #ffffff;  --sl-color-bg-nav: #ffffff;  --sl-color-bg-sidebar: #ffffff;
  --sl-color-bg-inline-code: rgb(0 0 0 / 0.04);
  --sl-color-hairline: rgb(0 0 0 / 0.1);
  --sl-color-hairline-light: rgb(0 0 0 / 0.1);
  --sl-color-hairline-shade: rgb(0 0 0 / 0.1);

  --sl-color-accent-low: #f3e6c8;  --sl-color-accent: #9a6500;  --sl-color-accent-high: #6e4900;
  --sl-color-text-accent: #9a6500; --sl-color-text-invert: #ffffff;
}

/* Ochre means "waiting on you": take it off navigation state. */
.sidebar-content [aria-current='page'] {
  color: var(--sl-color-white);
  background-color: rgb(255 255 255 / 0.15);
}
[data-theme='light'] .sidebar-content [aria-current='page'] { background-color: rgb(0 0 0 / 0.12); }
starlight-toc a[aria-current='true'] { color: var(--sl-color-white); }

/* Serif for page titles and the wordmark only. */
h1#_top, .site-title { font-family: var(--cairn-serif); }

/* Hairline rings instead of shadows or bars. */
.starlight-aside { border: 1px solid var(--sl-color-hairline); border-radius: 0.5rem; }
.starlight-aside--note, .starlight-aside--tip { background: transparent; --sl-color-asides-border: var(--sl-color-hairline); --sl-color-asides-text-accent: var(--sl-color-white); }
.starlight-aside--caution { --sl-color-asides-text-accent: var(--sl-color-text-accent); }
```

Selector sources (verified):

- `.sidebar-content` wraps the sidebar ([PageFrame.astro L43](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components/PageFrame.astro#L43)), and `[aria-current='page']` is the current-item rule ([SidebarSublist.astro L119-L125](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components/SidebarSublist.astro#L119-L125)).
- `<starlight-toc>` with `a[aria-current='true']` ([TableOfContents.astro L7](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components/TableOfContents.astro#L7), [starlight-toc.ts L19](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components-internals/TableOfContents/starlight-toc.ts#L19)).
- `PAGE_TITLE_ID = '_top'` ([constants.ts L4](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/constants.ts#L4)).
- Aside classes and variables ([asides.css L1-L26](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/style/asides.css#L1-L26)).
- Components that use `--sl-shadow-*`: Search, Pagination, MobileMenuToggle, MobileTableOfContents, LinkCard and Banner (found with `rg sl-shadow`).

After the shadows are gone, give Search, Pagination and the mobile TOC a `1px solid var(--sl-color-hairline)` ring (inferred). Not checked (guessed): the Fontsource package and family names. Confirm them, and the rendered colours, in the browser on the first build.

### Component overrides

- `SiteTitle`: serif wordmark. The default already links to the locale homepage (verified), so the override only changes the look.
- `Footer`: `import Default from '@astrojs/starlight/components/Footer.astro'`, render `<Default />`, then add a "Back to cairn.xmon.me" link (wrap pattern, verified [overriding-components.mdx L72-L80](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/docs/src/content/docs/guides/overriding-components.mdx#L72-L80)).
- Leave `Header`, `PageFrame`, `ThemeSelect` and `LanguageSelect` at their defaults. `ThemeSelect` already writes the `starlight-theme` key the homepage will read. `LanguageSelect` maps `/docs/x` ↔ `/zh-cn/docs/x` with `localizedUrl` (verified, [LanguageSelect.astro L1-L26](https://github.com/withastro/starlight/blob/62821331b95d55e9346ca34ebacc676d7be1f26b/packages/starlight/src/components/LanguageSelect.astro#L1-L26)). Override `Header` only if the docs need top-level links back to homepage sections. opencode needed a theme plugin for that (verified).

### Homepage, outside Starlight

- Copy `ThemeProvider`'s inline script into the homepage `<head>`: read `localStorage['starlight-theme']`, fall back to `prefers-color-scheme`, set `data-theme`. Reuse the same `--sl-*` tokens from `cairn.css`, so one token file themes both halves (inferred).
- Use `getRelativeLocaleUrl(locale, 'docs/install')` from `astro:i18n` for links into the docs. opencode V1 did this in its Header override (verified).

### Borrowed from Fumadocs, Nextra and opencode, built on Starlight

- A Markdown twin per page plus `llms.txt`, and a "Copy Markdown" button in the page header (Fumadocs page actions, opencode `.md` twins, Claude Code's `.md` alternate link; all verified). On Starlight this needs a `PageTitle` override plus an endpoint. No built-in exists in 0.43.1 that this research found (inferred).
- Write callouts as `:::note` and `:::caution` only. Ghostty's GFM alerts and Nextra's emoji callouts show the range; no emoji (Cairn rule).
- `<Tabs syncKey="os">` and `<Tabs syncKey="provider">`, which behave like Fumadocs `groupId`+`persist` and Nextra `storageKey` (verified all three).

## Not verified / blocked

- ghostty.org homepage: Jina returned an empty body twice, with and without the browser engine, so the homepage was read from source only.
- Pagefind's Chinese segmentation and its per-language index split: Pagefind source not read (guessed). Check with a `zh-cn` search on the first build.
- Astro's priority between `src/pages/[...locale]/index.astro` and Starlight's injected `[...slug]`: Astro source not read (guessed). Check with `astro build` and the `dist/` tree.
- One npm registry read (`registry.npmjs.org/@astrojs/starlight/latest`, which showed 0.43.1) went outside the agent-reach routes. The version above rests on `gh api` releases and `package.json`.

## Local clones

- withastro/starlight at 62821331b95d55e9346ca34ebacc676d7be1f26b: /tmp/amp-librarian/withastro__starlight
- fuma-nama/fumadocs at f0cb8f1a932aebeabec763bb43c4f2fa676de303: /tmp/amp-librarian/fuma-nama__fumadocs
- shuding/nextra at d6e80e1dd627b781429a6ee989b15ebba688c8ea: /tmp/amp-librarian/shuding__nextra
- sst/opencode at d432a06b9c07bab0be4e8d642173b1cb14137f11 (sparse: services/site): /tmp/amp-librarian/sst__opencode; V1 Starlight config at 1a5b7239: /tmp/oc-web/astro.config.mjs
- ghostty-org/website at 464e0f71ed50e94ceee8df84a9bb687e48cc0392: /tmp/amp-librarian/ghostty-org__website
- pingdotgg/t3code at 45649628dcb7d07cf6b91d94f94d327037a2967f (sparse: apps/marketing): /tmp/amp-librarian/pingdotgg__t3code
- Live page reads: /tmp/sites/*.md
