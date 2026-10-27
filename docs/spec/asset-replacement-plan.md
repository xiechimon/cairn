# Asset replacement plan (release policy / copyrighted-asset inventory / attribution conventions / trigger conditions)

> Wayfinder ticket: xiechimon/pacman #44 (`wayfinder:grilling`, decided 2026-09-22).
> Upstream evidence: `docs/research/r1-site-inventory.md` (cited as `r1 §line`), `r2-app-ui-inventory.md`, `r3-protocol-executor.md`, `r5-icons.md`, `r7-rebaseline.md`; naming-slot canon `02-architecture-parity.md §5.8`; tech-stack additions from #43 (`01-stack-v2.md §9`).
> Positioning: this volume locks down, in one pass, the **execution details** of "replication goes on GitHub as-is first, replace afterwards" (locked 2026-09-19) — which assets to replace, with what, when it triggers, and how attribution is written. Implementers make no further asset decisions from here.
> Type notation: inherited / locked (newly decided by this ticket) / handed off (this ticket fixes only the policy; execution belongs to another ticket) / fallback (a retreat path with trigger conditions).

## 0. Summary of conclusions

| # | Decision | One-liner |
|---|---|---|
| D1 | Product positioning | **Local self-use**: domain not applicable, no release/promotion plan; repo stays PUBLIC |
| D2 | Product name | **Pacman** (= repo name, not renamed); §5.8's eight brand slots mechanically expanded in §2 |
| D3 | Replacement trigger | Main trigger = **before any external promotion or production deployment**; fallback = **upon receiving a takedown**; a dormant guardrail, no calendar milestone. **Status: triggered 2026-09-23** (brand-slot batch #109, reason in §D3 trigger record) |
| D4 | Evidence/product dichotomy | `docs/research/assets/` = research evidence, **kept forever**; the product surface is **forbidden to reference it**; all product assets go through the replacement inventory |
| D5 | Icons | Replace everything with the **official lucide package** (ISC); **self-drawing forbidden**; mapping prioritizes looking good over 1:1 |
| D6 | emoji grid | A **gitmoji** (npm `gitmojis`, MIT) curated excerpt of 24–48 entries; the behavior contract stays per r1:464 |
| D7 | Fonts | Inter / JetBrains Mono = **SIL OFL open-source fonts, not replaced**; the replacement value = compliant re-hosting from official sources + keeping the OFL notice |
| D8 | Bitmaps/Logo | The original site's 9 bitmaps + 46 splashes **were never downloaded into the repo**; the product uses a **self-designed `[p]` glyph logo** deriving the full set |
| D9 | Attribution convention | Prominent README first-screen disclaimer (draft in §6) + keep Lorelei CC0 attribution + OFL font attribution |

---

## D1 · Product positioning and repo visibility

**Locked.** Product positioning = **local self-use**. Domain candidates are **not applicable** (no external release plan). The repo `xiechimon/pacman` stays **PUBLIC** (established fact: public since 2026-09-08, including the as-is assets and the r1-r7 research evidence), **not renamed** — repo name = product name = pacman, no external confusion.

"Local self-use" does not change the locked decision "go on GitHub as-is first, replace afterwards": what is public is the **research repository** (replication process + evidence + spec), not a product release. D3's trigger condition is a dormant guardrail that **takes effect automatically when the positioning changes (external promotion / production deployment)**.

Risk note (recorded, no guardrail): `pacman` shares its name with the Arch Linux package manager; an executor machine running Arch would hit a PATH collision; this Mac has no such problem, out of reach for local self-use. npm facts: `pacman` (0.15.0, static-site generator) and `pacman-cli` (1.1.4) are both taken — **irrelevant**, the package-name slot is a private package never published (§2).

## D2 · Product name and brand-slot expansion (canonical filling of §5.8)

**Locked.** Product name **Pacman** (UI word) / `pacman` (internal lowercase name). All slots of 02 §5.8's naming-constant table are filled below; this table is that slot's **canonical replacement-value table**:

| Slot | todos.dev current value | Replacement value |
|---|---|---|
| CLI command name | `tds` | `pacman` |
| env prefix | `TDS_SERVER` etc. | `CAIRN_SERVER` / `CAIRN_API_KEY` / `CAIRN_TEAM` / `CAIRN_WORKSPACES_DIR` |
| User home directory | `~/.tds` | `~/.pacman` |
| Workspace directory | `~/.tds/workspaces/<conversationId>` | `~/.pacman/workspaces/<conversationId>` |
| Branch prefix | `tds/conv-` | `pacman/conv-` |
| API key prefix | `tds_<48hex>` | `pacman_<48hex>` |
| Machine token | 64hex, no prefix | keep (locked in 02 §5.8, not a brand slot) |
| git hosting domain segment | `git.todos.dev` | local hostname stands in (locked in 02 §5.8) |
| Remote MCP path | `/api/mcp` | keep (the shape carries no brand) |
| Package name | `@todos-dev/cli` | `@pacman/cli` (**private package, not published to npm**, the taken names are irrelevant) |

Same-slot extensions (recorded by the r1/r2 inventory, renamed in the same batch as the table above):

| Extension slot | Current value | Replacement value |
|---|---|---|
| CLI deep-link scheme | `tds://` | `pacman://` |
| First-visit tracking cookie | `tds_ft` | `pacman_ft` |
| localStorage key prefixes (~15 keys) | `tds-theme` / `tds.locale` / `tds-locale` / `tds.sidebarProjectsCollapsed` / `tds.panel-maximized` / `tds.cache.*-v*` | same-shape replacement with `pacman-` / `pacman.` |
| daemon log | `~/.tds/daemon.log` | `~/.pacman/daemon.log` |
| manifest `name`/`short_name` | `Todos` | `Pacman` |
| `apple-mobile-web-app-title` | `Todos` | `Pacman` |
| Site `<title>` | `Todos — The task-driven workspace…` | self-written (§4 copy entries) |
| iOS bundle id / AASA | `78MKE32NHU.dev.todos.app` | **not applicable** (the replication has no native iOS app) |

Protocol paths/field names (`/api/machine/tasks/claim` etc.) **keep their shape** — only the brand slots in the table above may change (02 §5.8's discipline carries over).

## D3 · Replacement timing trigger conditions

**Locked.** Dual trigger, no calendar milestone:

1. **Main trigger**: before any **external promotion** (releasing the product, publicly demoing the product surface, distributing installers) or **production deployment**, everything in the §3 inventory is fully replaced.
2. **Fallback trigger**: **upon receiving a takedown / infringement notice**, execute the replacement immediately (not waiting for the main trigger).

The research repository's own publicness (D1) does not constitute a trigger — what is public is the replication process and its evidence, not product promotion. During the pure-research publicness period, inventory assets are allowed to exist in "as-is replication" form inside the product code (`apps/web`); this is the execution semantics of the locked decision "go on GitHub as-is first".

**Handed off**: the replacement execution opens its own ticket (a one-time batch, including the parity rebaseline, see D5), not interleaved with feature tickets (the web/#5x line).

**Trigger record (2026-09-23, #109)**: the user runs the genuine todos.dev daemon on the same machine — `~/.tds` is occupied by the genuine one (machine.json/token not overwritable), the replication's default state directory collides by name, and the two cannot run in parallel on one machine; on that basis the **replacement phase was executed early** (not waiting for the main/fallback trigger). This batch's execution surface = §2's brand-slot canonical table in full + the same-slot extensions (the localStorage key family / manifest brand slots / sw.js notification title / env vocabulary / API key prefix / the UI brand word Todos→Pacman) + the parity rebaseline (baseline cut from rendered output; the original site's screenshots stay in `docs/research/assets/` per D4(a)). **Not executed** (still awaiting the separate replacement ticket): D6's emoji subset, §3.4's remaining self-written copy (landing/install/changelog etc.); D5's full switch to the official lucide package source and D7's official-source re-hosting convention also belong to that ticket (#249 already executed D5's five custom-item replacements, see below). **Later execution record**: D7 font self-hosting + D8 bitmap derivation (logo.svg / icon family / AppIcon) landed with 590cdddb / 3029ce9d / a06b5b4c; D5's five custom items (clock/key/server/user/task badge, including Thin variants) switched to lucide-static official glyphs + D8 real screenshots + removal of the manifest's original-site `related_applications` pointers = executed by **#249 (2026-09-25)**, with the pwa.test.ts gate comment closed in sync.

## D4 · Evidence/product dichotomy

**Locked.**

- **(a) Research evidence = kept forever**: all original-site screenshots under `docs/research/assets/` (r2 63 / r3 ~52 / r5b 15 / r7 54 authoritative-baseline shots), the icons.json dumps (r5/r6/r7), and r1's captured CSS/manifest/llms.txt/i18n four-language files — they are the citation anchors of the r1-r7 spec volumes and the parity gates' comparison baselines, **not in the replacement inventory, never deleted**.
- **(b) Hard boundary**: the `apps/web` product surface is **forbidden to reference** anything in `docs/research/assets/`. All assets inside the product come from the replacement inventory's (§3) replacement values. Guardrail: CI/lint checks that product code does not import/path-reference `docs/research/`; the replacement-execution ticket audits it once.
  - Exception (established fact, dissolved by the replacement-execution ticket): `scripts/generate-icons.mjs` uses `docs/research/assets/r*/icons.json` as a **build-time input** to generate `apps/web/src/icons/*.tsx` — the generated output enters the product, the raw dumps do not enter the runtime; when D5 executes the switch to the lucide official package source, this dependency disappears naturally.

## D5 · Icons: switch everything to lucide, self-drawing forbidden

**Locked.** At the replacement trigger, all `apps/web` icons switch to the **official lucide package** (ISC license; suggested: pin `lucide-static` as the generation source, or depend directly on `lucide-react`; the integration form belongs to the replacement-execution ticket). **Self-drawing any icon is forbidden.** Mapping prioritizes **looks good / semantic fit**, **not 1:1 glyph parity with the original site**.

Source-verification facts (2026-09-22, 16 icons sampled against lucide v0.105.0/v0.263.0/v0.427.0/0.445.0/1.47.0):

- Original-site icons = **lucide-derived, confidence ~0.95**: 12/16 match some lucide version byte-for-byte or at attribute level (including lucide-specific fingerprints like `16.65`, `M9.09 9a3…`, `M6 5v11`, ruling out pure feather); copied in batches spanning v0.105→v0.427.
- **5 non-lucide custom entries** (the legal-risk surface, covered by this decision): clock (scheduled), key (credentials), server (machines), user (account), task badge (dog-ear square + check). Reference mapping (re-judgeable, looks-governs): `clock` / `key` / `server` / `user` / `square-check-big`.
- The existing `apps/web/src/icons/*.tsx` (generate-icons.mjs output) is, in the main, fine to treat as lucide ISC-derived; replacement = switch to the official package source + the custom items above switch to their lucide counterparts.

**Corollary**: the icon-region parity comparison gets **no per-pixel exemption list** — after replacement the lucide current-version glyphs rule; deviations are expected and accepted; the replacement-execution ticket rebaselines once (against the original site's screenshots).

## D6 · Emoji frequently-used grid subset

**Locked.** The topic icon picker's frequently-used grid = a **gitmoji curated set** (npm `gitmojis`, MIT, 75 entries of JSON with emoji/name/description), excerpted to the **24–48** entries semantically fitting task topics (🐛 🚀 ✨ 📝 🎉 🎨 ⚡️ 🔥 etc.; the final subset is scoped by the replacement-execution ticket; description can serve as tooltip).

The behavior contract is unchanged (r1:464): frequently-used grid + free input box; validation accepts only **exactly one emoji cluster** (flags/keycaps/skin-tone/ZWJ); `PATCH` accepts title/emoji. Usage-history-driven "frequently used" ordering can be layered on later (industry status: emoji-mart's / emoji-picker-element's "frequently used" are both local user-history driven, with no authoritative universal set — a curated list is the same kind of approach).

The original site's specific subset has no dump (zero grep hits in r1-r7), and **no logged-in capture will be done** — this decision substitutes an open-source curated set, closing the gap.

## D7 · Fonts: not replaced, compliant re-hosting

**Locked.** Inter variable (48,256 B) and JetBrains Mono variable (40,404 B) are both **SIL OFL 1.1 open-source fonts** — not a copyright-risk item, **not replaced**. The replacement value = woff2 downloaded from official sources (rsms.me/inter, the JetBrains official repo, or Google Fonts) and re-hosted + the OFL notice kept with the package; the 859 B @font-face CSS (`assets/r1/71fd990866a15643.css`, with Arial fallback metric overrides) is reused as is. The original site's woff2 binaries were never downloaded into the repo (r1 §10.2); if the product references the original site's URLs, switch to local re-hosting at replacement time.

The Lorelei avatar font: **keep the attribution** (see D9); the font file was not taken; if the product uses the avatar style, land it with the attribution text + a self-taken font file.

## D8 · Bitmaps and logo: self-designed `[p]` deriving the full set

**Locked.** The original site's favicon `[t]` = a bracket-glyph logo typeset in JetBrains Mono (text, not paths). The product logo = a **self-designed `[p]` glyph in the same design language** (a new brand letter, not a copy). Derive the full bitmap set (generated at trigger time; the original site's binaries were never committed, nothing to delete):

favicon.svg / favicon.ico / apple-touch-icon.png / icon-192 / icon-512 / icon-maskable-192 / icon-maskable-512 / og.png(1200×630) / the 46 apple splashes / PWA screenshots narrow(780×1688)+wide(2560×1600, switched to real shots of the replicated UI) / the install-page illustration.

## D9 · Attribution convention

**Locked.** A **prominent README first-screen disclaimer** (not impersonating the official, draft in §6) + the full third-party attribution-retention table (§5). The first good-faith evidence in a takedown dispute (no-confusion); costs one paragraph. No separate convention inside docs/spec.

---

## 3. Asset replacement inventory (replication value → replacement value)

Execution semantics: at the D3 trigger, replace item by item per this table; "in repo" means under `docs/research/assets/` (kept forever per D4(a); what is replaced is the **product-surface reference**).

### 3.1 Brand names / domain traces

| Entry | Replication value (source) | Replacement value |
|---|---|---|
| CLI/env/directory/branch/key prefix family | `tds` / `TDS_` / `~/.tds` / `tds/conv-` / `tds_` (r1:466,494) | §2 expansion table (the `pacman` family) |
| npm package name + install copy | `@todos-dev/cli`, `npm install -g @todos-dev/cli@latest`, `tds start` (r1:494; r2:235,250) | `@pacman/cli` (private package; install copy self-written) |
| Deep-link scheme | `tds://` (r1:456) | `pacman://` |
| cookie / localStorage key family | `tds_ft`; `tds-theme` etc., ~15 keys (r1:41; r2:66-85) | `pacman_ft`; same shape with `pacman-` |
| MCP endpoint examples | `https://todos.dev/api/mcp`, `Bearer tds_<key>`, mcp.json server name `todos` (r1:150-154) | local hostname + `pacman` server name + `pacman_<key>` |
| git hosting domain | `git.todos.dev/<teamId>/<repoName>` (r3:58) | local hostname stands in (02 §5.8) |
| iOS bundle/AASA | `78MKE32NHU.dev.todos.app` (r1:307,313) | not applicable (no native iOS app) |
| LLM corpus endpoints | `todos.dev/llms.txt`(5,848B) / `llms-full.txt`(311,487B, in repo) | self-written or empty (shape kept) |
| Footer copyright line | `© 2026 Todos` (r1:109; r2:372) | `© 2026 Pacman` (self-attribution, research-project convention) |
| Team avatar style name | `avatarStyle:"notionist…"` (r2:74) | third-party style name, decided by implementation choice (not a todos.dev copyright item) |
| robots Disallow routes | `/api/ /app/ /admin/ …` (r1:44-45) | shape kept (no brand) |

### 3.2 Logo / icon bitmaps

| Entry | Replication value (source) | Replacement value |
|---|---|---|
| favicon.svg (the `[t]` logo source, 286B, in repo) | JetBrains Mono typeset `[t]` (r1:289) | self-designed `[p]` same-language glyph (D8) |
| favicon.ico / apple-touch-icon / icon-192 / icon-512 / maskable-192 / maskable-512 / og.png | URL + byte-size records only (r1:283,290; binaries not in repo) | derived and generated from the `[p]` logo (D8) |
| 46 apple splashes | `/splash/apple-splash-{W}x{H}.png` (r1:291; not in repo) | derived and generated from the `[p]` logo (D8) |
| `[todos]` text logo (/zh/install top nav) | literal `[todos]` (r2:365) | `[pacman]` |
| PWA screenshots narrow/wide | 780×1688 / 2560×1600 (r1:285; not in repo) | real shots of the replicated UI (D8) |
| Workspace inline SVG icon set | icons.json dump (r5:56-62; r7 authoritative 218 entries/53 unique; in repo) | full switch to the official lucide package source (D5) |
| topic default icon | the "boxed hash" `#` (r1:464) | lucide `hash` (within D5's policy) |

### 3.3 Fonts

| Entry | Replication value (source) | Replacement value |
|---|---|---|
| Inter variable woff2 (48,256B) | `/_next/static/media/6c596dfcddeca1e9-s.p.woff2` (r1:187; not in repo) | official-source re-hosting + OFL notice (D7, font unchanged) |
| JetBrains Mono variable woff2 (40,404B) | `/_next/static/media/a865edea076e0166-s.p.woff2` (r1:188; not in repo) | same as above (D7) |
| @font-face CSS (859B, in repo) | `assets/r1/71fd990866a15643.css` | reused as is (metric overrides are bound to the fonts) |
| Font stack / CJK fallback | r1:197-200 | carried over (no copyright item) |

### 3.4 Proprietary copy / manifest brand slots

| Entry | Replication value (source) | Replacement value |
|---|---|---|
| manifest brand slots | `name/short_name:"Todos"`, description, `start_url:"/app"` (r1:274-278; in repo) | `Pacman` + self-written description; `start_url` shape kept; icons URL switched to D8 output; sw.js brand slots in the same batch (#43 addition item 4) |
| Site `<title>` / tagline | `Todos — The task-driven workspace for humans and agents.` (r1:116,429) | self-written (not a word-by-word rewrite of the original sentence; rewritten from the product positioning) |
| Landing copy in full (H1/lede/9 FAQs/CTA, four languages) | r1:100-114 (in repo) | self-written rewrite (the research-project home page may directly use the README convention) |
| 21 feature-card titles (including `powered by Doubao speech recognition`) | r1:125,130 (in repo) | self-written; the Doubao name-drop deleted or rewritten per the actual speech solution |
| /install, /mcp, /login, pricing-page copy | r1:135-165,325-347 (in repo) | self-written rewrite; the pricing page can be an empty shape for local self-use |
| Changelog in full (105 dates/326 entries/599KB) | r1:434-436 | **shape kept, content at discretion** (locked in 02 §6.1): self-written or empty |
| Untranslated banner (zh-TW/ja copy-over obligation) | r1:511-513 | self-written same-function banner |
| In-app UI Chinese string set | r2 throughout (63 screenshots in repo) | function words (`看板`/`定时`/`密钥`… — board/scheduled/credentials…) are domain vocabulary, not brand assets, **kept**; entries containing `Todos`/`todos.dev` (the r2:369 install block, `Todos 将在独立窗口中打开…`) switch to `Pacman` |
| Command palette `前往` (go-to) group, 10 items | r2:360 | kept (domain vocabulary) |
| Built-in model table 8 slugs + surcharge copy | r2:258-267 | 02 §6.1 exclusion item (built-in models go Pro, not replicated): copy self-written or empty |
| hero mock data (`Avery's team`/`Inkwell`/`Pulse`/#151-201) | r1:83-96 (pure HTML/CSS, no bitmaps) | invented demo data |

### 3.5 Illustrations / screenshots

| Entry | Replication value (source) | Replacement value |
|---|---|---|
| Original-site full-screen screenshots ~130 + icons.json | `docs/research/assets/` (r2/r3/r5b/r7) | **not replaced** (D4(a) research evidence); product surface forbidden to reference (D4(b)) |
| r5 batch PNGs (right-edge gap, voided) | `assets/r5/` (only 99-board-initial.png remains) | not replaced (evidence; the void annotation lives in r7) |
| Whole site has zero videos/iframes (r1:437) | — | no additional bitmap illustrations to clear |

### 3.6 Emoji grid

| Entry | Replication value (source) | Replacement value |
|---|---|---|
| topic picker frequently-used grid subset | no dump (r1:464, behavior record only) | gitmoji curated 24–48 entries (D6) |
| install timeline progress emoji (🔀🔄✅🚀) | r1:139 | kept (generic emoji characters, not brand assets) |

## 4. Third-party attribution / license obligations table

| Obligation item | License | Disposition |
|---|---|---|
| Lorelei avatar font (`Lorelei / © Lisa Wischofsky / Figma community file 1198749693280469639 / CC0 1.0`; on the original site's DOM, repeated per avatar ~40 times, r1:96,437) | CC0 1.0 | **keep attribution** (the original site's established behavior, replicated as is; D9) |
| Inter / JetBrains Mono | SIL OFL 1.1 | re-host with the OFL notice kept in the package (D7) |
| lucide icons | ISC | switch to the official package source, license header kept with the package (D5) |
| gitmoji data | MIT | npm `gitmojis`, declared with the package (D6) |
| pi SDK | MIT | lightest obligations, declared with the package (adoption locked in 00 D1) |
| Claude Agent SDK | © Anthropic PBC, All rights reserved + Commercial ToS | **not adopted** (rejected in 00 D1), no obligations |
| craft-agents-oss | Apache-2.0 + TRADEMARK.md | **zero vendoring** (locked in 00 D2), no obligations; if the per-package escape hatch is enabled, follow its § keep LICENSE/NOTICE + the four Craft-brand removals |
| GitHub / Google OAuth button brands | their respective brand guidelines | function buttons use names/logos per the official brand guidelines |
| Doubao speech recognition name-drop | — | copy-level brand trace, deleted or rewritten per the actual solution (§3.4) |
| Stripe style hints (`checkout-*` keyframes) | — | the animation names carry no brand literal; keeping the shape suffices |
| Cloudflare (server header / Sandboxes name-drop) | — | infrastructure fact descriptions, kept in docs |

## 5. Gap-closure record

| #43 addition item | Disposition |
|---|---|
| 1. Icon glyph extraction (logged-in capture / tracing) | **closed**: icons.json is in the repo and generate-icons.mjs has produced the components; at replacement switch to the lucide source per D5, no more glyph extraction |
| 2. Font and bitmap downloads (2 woff2 + 9 bitmaps + 859B CSS) | **downgraded**: the CSS is in the repo; woff2 obtained from official sources per D7; the 9 bitmaps self-derived per D8, **the original site's binaries are not downloaded** |
| 3. Emoji frequently-used grid subset | **closed**: D6's gitmoji substitute, no logged-in capture |
| 4. PWA brand-slot replacement | **merged**: manifest/sw.js brand slots enter §3.4, rename timing = the D3 trigger |

## 6. README disclaimer draft (the D9 convention)

```markdown
> **免责声明 / Disclaimer**
> 本仓库是 todos.dev 的 1:1 复刻研究项目（像素级 UI + 功能等价），仅供个人学习研究，
> 与 todos.dev 官方无任何关联，未获其认可或赞助。Todos、todos.dev 及其 logo、界面截图、
> 文案等素材版权归原权利人所有；仓库内 `docs/research/` 下的抓取记录与截图仅作研究证据引用。
> 复刻产品名为 Pacman，本地自用，不对外提供服务。
> 素材替换政策与逐项清单见 `docs/spec/asset-replacement-plan.md`（#44）。
```

## 7. Premortem (assume the replacement plan has failed; the three likeliest causes of death)

| Cause of death | Guardrail |
|---|---|
| 1. The positioning quietly changes (external promotion/deployment) while the D3 trigger is forgotten, shipping with todos.dev assets | The trigger condition is written into this volume + the README disclaimer points here; the replacement-execution ticket opens **first** at the D3 trigger; the promotion action is gated on checklist sign-off |
| 2. The product surface unknowingly references research assets (screenshots/dumps seeping into `apps/web`) | D4(b) hard boundary = CI/lint forbids product code from referencing `docs/research/` paths; the replacement-execution ticket audits; the sole existing build-time dependency (generate-icons.mjs) dissolves with D5 |
| 3. At replacement execution the parity gates go red across the board, blocking the running feature tickets | D5 already ruled: no per-pixel icon exemptions, deviations expected and accepted; replacement execution = a separate ticket rebaselining once, not interleaved with web/#5x feature tickets |

## 8. Handoff list

| Handoff item | Destination |
|---|---|
| Replacement execution (the full §3 table + parity rebaseline + D4(b) CI guardrail landing) | A separate execution ticket opens at the D3 trigger. **The brand-slot batch + parity rebaseline were executed (#109, 2026-09-23)**; D5's five custom items switched to lucide-static + D8 real screenshots + manifest original-site pointer removal were executed (#249, 2026-09-25); §3's remaining items (D5's full package-source switch, D6, D7's official-source re-hosting convention, self-written copy) still await a ticket |
| gitmoji subset scoping (final pick of 24–48) | the replacement-execution ticket |
| `[p]` logo design and bitmap derivation pipeline | the replacement-execution ticket |
| README disclaimer paragraph on disk | executable immediately (independent of the trigger condition); suggested in the same PR as this volume |
| sw.js / manifest brand-slot concrete rewriting | the replacement-execution ticket (02 §5.8 linked). **Executed (#109)**: name/short_name/description self-written + sw.js notification title; switching icons URL to D8 output still awaits a ticket |
