# Logo design prior art for Cairn (2026-11-08)

Evidence tags: **实测** = fetched or read this session (link given); **推断** = derived from 实测; **猜测** = everything else.
Fetch method: `curl` for HTML heads, manifests and icon files; headless `chromium --dump-dom` where `curl` got 403 (claude.ai, openai.com) or the icon is injected by JS (ampcode.com); Jina Reader (`r.jina.ai`) for brand pages; `gh api` for the t3code repo. Icons were rasterized with `rsvg-convert` / `magick` at 16 px and 160 px to compare.

## 1. Question and context

What mark, plate and size handling should Cairn's logo use, given how comparable developer and AI products ship theirs?

Cairn today (all 实测, read in this worktree):

- `apps/web/public/logo-mark.svg` and `apps/web/src/lib/brand-mark.ts`: a ~3-turn Archimedean spiral drawn as an outlined stroke (one filled path with round caps). Band ≈ 0.085 and turn pitch ≈ 0.175 in a 0.971 viewBox, so band and gap are each ~9% of the mark width.
- `apps/web/public/logo.svg`: the same path, cream, on a `#244b32` rounded square (824/1024 body inset 100, rx 185). The PNGs (`icon-192*.png`, `icon-512*.png`, `icon-maskable-*.png`) add a dithered pixel texture. `icon-512-dark.png` and `icon-512-light.png` look identical (both green) when rendered side by side.
- `apps/web/index.html`: SVG favicon = `logo.svg` (the whole plated app icon, no `prefers-color-scheme` rule inside); PNG favicon and apple-touch-icon switch on `media="(prefers-color-scheme: …)"`. iOS ignores `media` on apple-touch-icon (the HTML comment there says so too).
- `apps/web/src/chief/chief-fab-icon.tsx` `SpiralMark`: a different drawing, a 1.5-turn stroked spiral (`stroke-width 58` in a 452 viewBox ≈ 12.8%, round caps, `currentColor`) for the sidebar Coordinator row.
- Rendered at 16 px (实测): the 3-turn spiral (green plate or near-black plate) turns into a grey blob; at 32 px it reads. Band and gap come out at ~1 px each at 16 px (推断 from the geometry above).
- The maskable 512 PNG keeps the spiral inside the 40% safe circle (实测 overlay).
- ian likes a light-grey ~3-turn spiral on a near-black rounded square and dislikes the green textured app icon (brief).

## 2. Comparison table

| Product | Glyph vs wordmark | Stroke / fill | Small-size handling | Light / dark | Plate | UI glyph == app icon? | Guidelines |
|---|---|---|---|---|---|---|---|
| Claude (Anthropic) | Spark glyph. In-app logo `ClaudeLogo` is spark + "Claude" lockup, 112×24 viewBox, `currentColor` (实测 claude.ai/login DOM) | Filled star of tapered rays (实测 SVG) | SVG favicon = bare clay spark `#D97757`, no plate; favicon.ico 16/32/48 same spark (实测) | No media query; one clay color serves both (实测) | Favicon: none. Apple-touch 180: white spark on clay plate. Press-kit `ClaudeIcon-Rounded.svg`: 128 box, rx 30 (23%), gradient + 35% clay overlay, ivory spark (实测) | Same spark drawing everywhere; UI uses one-color `currentColor` version (实测) | No guideline doc in press kit; kit has "Claude Spark - Clay", "Claude icon" Rounded/Square, logo in Slate/Ivory/One-color (实测 zip listing) |
| Linear | Glyph (circle with diagonal cuts) + separate wordmark | Fill (实测) | Dedicated 16×16-viewBox `favicon.svg`: flat white glyph on black, rx 2 (12.5%) (实测). App icon 512 is a metallic shaded render (实测) | SVG favicon has no media query; always black plate (实测) | Favicon black plate; PWA icons dark plate; separate maskable PNGs at 128/192/512 with extra padding (实测 manifest) | In-app logo is the same glyph flat, `currentColor`, 100 viewBox (实测 linear.app DOM); app icon adds lighting (推断) | linear.app/brand: room to breathe, monochrome wordmark preferred, logomark for tight layouts, icon "with an appropriate corner radius"; no numeric clear space (实测) |
| Vercel | Triangle symbol; wordmark preferred, symbol only when space is short; usable as `▲` U+25B2 (实测) | Fill | favicon.ico 16/32/48: white triangle on black circle, transparent corners (实测 render). No SVG favicon | `theme-color` switches #FAFAFA/#000 via media; icons do not (实测) | ico: circle plate. Apple-touch 180 and PWA 512: full-bleed black square (实测) | Header uses same triangle path `currentColor` (实测 vercel.com DOM) | vercel.com/geist/brands: clear space = symbol height; don't modify (实测) |
| Raycast | Glyph + separate wordmark (实测 press page) | Fill | Single 1024×1024 PNG as favicon, no small variant (实测) | Press: dark logo only on dark, light only on light; dark backgrounds preferred, #151515 (实测) | Favicon = full app icon with dark plate (实测) | Not checked: no public app DOM | raycast.com/press: don't alter app icon colors; Figma app-icon template (实测) |
| Arc | Glyph "A" | Fill, multi-color | `favicon.png` 32×32 only, no plate (实测) | Light `theme-color` only (实测) | None on favicon | Not checked | blocked: arc.net/press now redirects to the sunset page ("Arc is sunsetting on December 22, 2026") (实测) |
| t3code | "T3" text glyph | Fill (实测 `T3Wordmark.tsx`) | ico 16–256, 16/32 PNG exported from one Icon Composer project; no simplified drawing (实测 repo `assets/README.md`) | No media query; always black (实测) | prod `icon.json`: solid black fill; macOS body 824/1024 inset 100; Android foreground re-rendered to fit the 72/108 dp safe zone (实测) | Yes: sidebar `T3Wordmark` and `assets/prod/app-icon.icon/Assets/text.svg` are the same path; sidebar sizes it to `h-[1cap]`, `currentColor` (实测) | None published (猜测: none exists) |
| Amp | Wordmark "amp" as the icon (实测) | Fill | SVG favicon = whole app icon (1024 box, rx 160 = 15.6%, multi-stop dark green gradient); unreadable at 16 px (实测 render) | No media query in favicon; `theme-color` switches #dfdfc1/#091c1e (实测) | Dark green gradient plate; manifest ships `any`, `maskable` and `monochrome` (实测) | blocked: header logo not found in the marketing DOM dump | blocked: ampcode.com/press is 404 |
| Cursor | Cube glyph; header is cube + wordmark lockup, `currentColor` (实测) | Fill; app icon cube is 3-tone shaded, header is one color (实测) | Separate `favicon.svg` and `favicon-light.svg` | Two SVG files chosen by `<link media="(prefers-color-scheme)">`; apple-touch has a `-light` and a dark file (实测) | Rounded-square (superellipse) plate inside the favicon SVG itself; manifest icons dark plate (实测) | Same cube, flattened to one color in UI (实测) | cursor.com/brand: asset grid only, no written rules (实测) |
| OpenAI 2025+ | Wordmark (OpenAI Sans, circular O) is primary; Blossom is secondary: "DON'T use the Blossom as the primary branding" (实测) | Fill (interlaced outline shape, 实测) | openai.com `favicon.svg`: Blossom on a full circle (rx 90 in 180), colors inverted by an internal `@media (prefers-color-scheme: dark)` (实测 via chromium). chatgpt.com SVG favicon: no plate, fill #000 → #fff by media query (实测) | In-SVG media query on both domains (实测) | openai.com: circle plate. chatgpt.com: none on favicon; 180 apple-touch white circle (实测) | Not checked (openai.com app DOM 403 for curl) | openai.com/brand: prescribed clear space, no colors, no effects/textures, don't use over busy images, "use the Blossom with lots of open space" (实测) |

Links (all 实测 this session): <https://claude.ai/login>, <https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/cd02a42d9-Vq_H3mgS.svg>, <https://www.anthropic.com/press-kit> (26 MB zip), <https://linear.app/static/favicon.svg?v=2>, <https://linear.app/static/pwa.webmanifest?v=4>, <https://linear.app/brand>, <https://vercel.com/manifest.webmanifest>, <https://vercel.com/geist/brands>, <https://www.raycast.com/favicon-production.png>, <https://www.raycast.com/press>, <https://arc.net/favicon.png>, <https://arc.net/press>, <https://github.com/pingdotgg/t3code/tree/main/assets>, <https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/T3Wordmark.tsx>, <https://ampcode.com/favicon.svg?v=2>, <https://ampcode.com/site.webmanifest>, <https://cursor.com/marketing-static/favicon.svg>, <https://cursor.com/marketing-static/favicon-light.svg>, <https://cursor.com/brand>, <https://openai.com/favicon.svg>, <https://chatgpt.com/cdn/assets/favicon.6a33781f61.svg>, <https://openai.com/brand>.

Sizing references (实测):

- W3C Manifest §2.3 <https://www.w3.org/TR/appmanifest/#icon-masks>: maskable safe zone is a centered circle with radius 2/5 (40%) of the icon size, "most icons will have around 10% padding"; `monochrome` purpose uses alpha only.
- web.dev <https://web.dev/articles/maskable-icon>: same 40% radius; check with DevTools › Application › "Show only the minimum safe area".
- Apple HIG App icons <https://developer.apple.com/design/human-interface-guidelines/app-icons>: embrace simplicity, fine details "may be hard to discern at smaller sizes"; prefer filled overlapping shapes; let the system add highlights and shadows instead of baking in effects; provide square unmasked layers; default/dark/clear/tinted appearances exist.
- Evil Martians "How to Favicon" <https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs>: `favicon.ico` (32), `icon.svg` with in-file `prefers-color-scheme` media query, 180 apple-touch (140 px art on 180 canvas, with background), 192/512 + a 512 maskable in the manifest.

## 3. Patterns

What most do (推断 from the table):

1. **One glyph, many renderings.** Every product with a glyph (Claude, Linear, Vercel, Cursor, t3code, OpenAI) uses the same drawing in the app icon, the favicon and the in-app header. The UI copy is flat and `currentColor`; the app icon adds a plate and sometimes lighting (Linear, Cursor, Claude kit). Nobody ships a second, different glyph for UI chrome.
2. **Fill, not stroke.** All nine marks are filled shapes. The nearest stroke-like marks (Linear's cuts, OpenAI's Blossom, Claude's rays) are outlined into fills.
3. **Small sizes: few products redraw.** Only Linear hand-draws a 16-unit favicon (and it is still the same glyph). The rest rely on a glyph that is already simple enough at 16 px. Amp is the counterexample: its plated wordmark favicon is unreadable at 16 px.
4. **Neutral near-black plates dominate.** Linear, Vercel, Cursor, t3code and Raycast use black or near-black plates (Raycast #151515, t3code #000, Linear #08090a theme). Color plates are rare: Claude clay and Amp green are the exceptions, and both are flat or gradient, never textured.
5. **Favicon plate is optional; app-icon plate is not.** Claude and chatgpt.com ship a bare glyph favicon; Linear, Cursor, Vercel and openai.com put a plate in the favicon. Every 180/512 icon has an opaque plate.
6. **Light/dark favicon: two working methods.** In-SVG `@media (prefers-color-scheme)` (openai.com, chatgpt.com, the Evil Martians recipe) or two SVG files on `<link media=…>` (Cursor). Products whose plate is near-black skip it entirely (Linear, t3code, Vercel) because a dark plate reads on both tab-bar colors.
7. **Brand rules are short.** Published rules cover clear space (Vercel: symbol height; OpenAI: prescribed), don't recolor or add effects or textures (OpenAI, Raycast), and give it room (Linear). None specifies a minimum pixel size.

Fit for Cairn: the **Linear / t3code pattern**. One filled glyph drawn in `currentColor` in the UI, the same glyph in a light neutral on a near-black rounded plate for every icon, no texture, no color media query needed. It matches what ian likes (light-grey spiral on near-black), follows the "no effects or textures" rule that OpenAI and Raycast publish, and removes the green dithered plate he dislikes. Linear adds the one exception Cairn also needs: a separate small-size drawing, because a 3-turn spiral fails at 16 px (实测 render in §1), and Linear shows that a dedicated 16-grid favicon of the same idea is acceptable practice.

## 4. Recommendation for Cairn

**Mark construction** (推断 from the geometry in §1 and the 16 px renders):

- Keep the filled (outlined-stroke) Archimedean spiral with round caps as the one drawing. Two optical sizes of the same spiral, sharing center, cap style and turn direction:
  - **Large (≥ 48 px rendered):** ~3 turns, as now. Band and gap each ≥ 2 px at 48 px, so ~4% of the icon box minimum.
  - **Small (16–32 px):** 1.5–2 turns. At 16 px the visible mark is ~12–13 px wide; band ≥ 1.75 px and gap ≥ 1.5 px give a pitch of ≥ 3.25 px. Over a ~6 px radius that allows about 1.75 turns, so pick 1.5 and snap band edges to the pixel grid on a 16-unit viewBox (Linear's approach). This is close to the existing `SpiralMark` (1.5 turns, ~12.8% band), so the small mark can replace it in the sidebar instead of staying a third drawing.
- Do not add a third, stroked UI-only spiral. Use the small filled mark in `currentColor` for the UI; animate it with a clip or mask if the busy trace in `SpiralMark` must stay (猜测 that this keeps the animation feasible; untested).

**Plate:** near-black neutral, e.g. the app's dark surface `#141715` (already `theme_color`) or a pure neutral around `#141414`. Mark color light grey around `#d6d6d2`. Rounded square, flat, no gradient, no dither. Radius ~22% of the side (Claude kit 23%, Linear favicon 12.5%, Amp 15.6%; iOS and Android mask it anyway, so the radius only matters for the SVG favicon and in-app uses).

**Favicon light/dark:** a near-black plate reads on both tab-bar colors, so serve one SVG favicon (plate + small mark), as Linear and t3code do, and drop the `media`-switched PNG favicons. If ian later wants a plate-less favicon, use one SVG with an internal `@media (prefers-color-scheme: dark)` that flips the fill (chatgpt.com pattern). Keep one opaque apple-touch-icon (iOS ignores `media`).

**Sizes and safe zones:**

- `favicon.ico` 32 (+16) from the small mark; `logo.svg` favicon with the small mark.
- `apple-touch-icon` 180: full-bleed opaque plate (iOS masks the corners), large mark at ~140/180 per Evil Martians.
- Manifest: 192 and 512 `any` (plate with corners), plus 512 `maskable` (full-bleed plate, mark inside the 40% radius circle) and optionally a 512 `monochrome` (alpha-only mark, as Amp ships).
- The 824/1024 body inset 100 used now matches the classic macOS area (t3code `assets/README.md`); keep it only for a desktop build.

**One drawing everywhere vs small variant:** one spiral family with two optical sizes. Generate every PNG and ICO from `brand-mark.ts` with a script plus a check that the outputs match the source (t3code's `icons:check` pattern), so the files cannot drift.

**Code touched:**

- `apps/web/src/lib/brand-mark.ts`: export the large path and a new small path (16-unit grid).
- `apps/web/public/logo-mark.svg`: large mark, `currentColor`-ready.
- `apps/web/public/logo.svg`: near-black plate + small mark (it is the SVG favicon).
- `apps/web/public/icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`: regenerate flat; delete `icon-192-dark/light.png` and `icon-512-dark/light.png` (identical today).
- `apps/web/public/manifest.webmanifest`: icon list (optional `monochrome`).
- `apps/web/index.html`: one SVG favicon, one apple-touch-icon, drop the `media` PNG pairs.
- `apps/web/src/chief/chief-fab-icon.tsx`: `SpiralMark` renders the small brand path instead of its own `SPIRAL_PATH`.
- `apps/web/src/components/texture/texture-core.ts`: stop using the `dither` filter for brand icons (other uses of the filter unaffected; check its consumers first).

Open questions for ian: exact plate color (`#141715` greenish-black vs neutral `#141414`), and whether the favicon keeps a plate (recommended) or goes bare with a media query.
