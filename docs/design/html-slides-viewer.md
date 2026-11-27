# HTML slides viewer in the artifact panel — plan, 2026-11-27

Owner decisions (ian, 2026-11-27, button-by-button review of Claude's artifact viewer): a slide deck gets `‹ 1/N ›` paging and `放映 ▷`; the view switch (single / grid), the thumbnail rail and speaker notes are later; editing tools (add slide, text, shapes) are not wanted. So this change is the smallest viewer: one slide at a time, paging, present, comments. It reuses the pager of the existing PDF deck ([`pdf-viewer.tsx`](../../apps/web/src/board/artifact/viewers/pdf-viewer.tsx) `PdfDeck`) so both decks look and work the same. Prior art: [`open-artifact-2026-11-27.md`](../research/open-artifact-2026-11-27.md) §3 Slice 1a; kinds table in [`artifact-panel.md`](artifact-panel.md).

## User scenario

Someone who installed Cairn today asks the Coordinator `把 Q3 复盘整理成 8 页幻灯片，周五开会用`. The task writes one `.html` file whose root is `<html data-slides>` and in which every slide is a `<section class="slide">`, attaches it with `attach_file`, and the reply shows its card. Clicking the card opens the artifact panel. Instead of one tall web page they see slide 1 fitted 16:9 and, at the bottom right, the pager `‹ 1 / 8 › ▷`. The arrows on the pager and on the keyboard (also while the pointer or focus is inside the slide) move between slides; `▷` fills the screen with the slide and Esc comes back on the same slide. `评论` works as on any HTML page: they click the figure `¥1,280 万` on slide 3, write `换成柱状图`, save. The pin shows only while slide 3 is shown, the comment list row reads `第 3 页幻灯片 · …`, clicking that row brings slide 3 back, and the message the task receives names slide 3 and the element.

- What they must already know: nothing beyond asking the Coordinator.
- Accounts, payments, keys: none. Rendering happens in the browser; no model call.
- Where it stores what they give: unchanged. The file is an attachment with `design_version` rows; a comment is a `design_comment` row whose `anchor` is `{type:'slide', slide}` next to the element target (the column and anchor type exist and the server already accepts them for `page` files).
- Where they get stuck or what they see on failure: an HTML file without the `data-slides` mark opens as a web page exactly as today, even when a carousel inside it uses `section.slide`; a deck file from outside Cairn without the mark also opens as a page; a missing version, a failed load and an empty file keep today's messages; if the browser refuses full screen the slide and the comment list stay in the panel and a toast says `未能全屏放映`.

Why: `artifact-panel.md` lists a slides kind and `packages/shared` already has the `slide` anchor, but nothing renders it, so an HTML deck opens as one tall page where slide 7 is a long scroll away and there is no way to present.

| Situation | What they see | What the system does | Wait and cost |
|---|---|---|---|
| Open an HTML deck | Slide 1 fitted 16:9, pager `‹ 1 / N › ▷` | The `<html data-slides>` mark picks the deck layout; a script injected into the sandboxed frame marks the top-level slides, shows one and reports the count | As opening a page today |
| Open a normal HTML page, carousel included | The page, as today | No `data-slides` mark, page path unchanged | Same as today |
| `›`, → or PageDown, inside or outside the frame | The next slide in the same frame | The parent posts the index into the frame; no reload | Instant |
| `▷` | The slide fills the screen; Esc returns to the same slide | `requestFullscreen` on the deck shell; comment mode and the list close | Instant |
| Comment on an element of slide 3 | Pin on slide 3 only; row `第 3 页幻灯片 · …`; row click shows slide 3 | Saves `anchor {type:'slide', slide:3}` with the element target | One API call, as today |

## Scope

1. A `page` artifact whose own `<html>` start tag (the first tag after an optional doctype and comments) carries a `data-slides` attribute (read as an attribute name; quoted values are skipped) renders as a deck (`isSlideDeck` in `apps/web/src/board/artifact/slide-deck.ts`); any other HTML renders exactly as today. The mark is explicit so a product page whose carousel uses `section.slide` is never taken over; the task instruction (row 9) tells agents to write it.
2. The deck frame is the same `DesignFrame` with an explicit 1920×1080 size in place of a viewport preset, so fit, zoom, pinch zoom and the comment overlay stay one implementation. A deck stylesheet and script are injected after the existing bridges: the script marks every `section.slide` not nested in another one with `data-cairn-slide`, pins them all at the frame's origin at 1920×1080, hides all but the current one with `visibility:hidden` (so comment anchors on other slides still resolve and hidden slides take no clicks), shows the index the parent posts and reports back the index it now shows, forwards the deck keys (arrows, PageUp, PageDown; not inside editable fields, not with a modifier) to the parent, and reports the slide count once. With zero slides the script only reports the count and changes nothing else.
3. The pager (previous, `n / N`, next, present), its key map and the full-screen request move out of `PdfDeck` into one shared `deck-pager.tsx`; the PDF deck and the HTML deck both use it. Previous is disabled on slide 1, next on slide N; present is hidden while presenting and when the browser offers no full screen (`document.fullscreenEnabled` false); a refused request shows the toast `未能全屏放映` for both decks (the PDF deck today drops the rejection).
4. The toolbar for a deck drops the viewport switch and the viewport menu group (a slide has one size) and keeps zoom, source view, history, comments and export. The draw-markup tool is not offered on a deck (a drawn mark carries no slide).
5. Present moves focus to the deck shell (the present button unmounts) and asks for full screen on it; once the browser reports full screen (`fullscreenchange`, read by `useFullscreen`), comment mode, a pending retarget and the comment list close; arrows page; Esc reaching the page never closes the panel while full screen is on, and the browser's own Esc exit returns to the same slide. A refused request changes nothing in the panel and shows the toast.
6. Comments on a deck save and retarget with `anchor {type:'slide', slide:<shown index + 1>}`, where the shown index is the one the frame last confirmed. Picks and confirmations travel in order on the same frame-to-parent channel, so a pick made before the frame switched is saved against the slide it was made on; when the confirmed slide changes the picked element and its open draft are dropped; a pin shows only while its slide is shown (a comment made on the file before it was a deck has no slide and shows in the list only); the list row reads `第 N 页幻灯片 · <label>「<text>」`; clicking the row's place link shows that slide (a slide number past the end shows the last slide); the task message keeps the slide and the element for structural selectors too (today `renderDesignCommentBlock` drops the element when `elementId` is empty).
7. If the frame reports zero slides (marked file without a top-level `section.slide`) the file renders as a normal page with the viewport switch.
8. State, readers and writers:
   - `wanted` (in `useSlideDeck`): written by the pager, the deck keys from the parent shell and from the frame, and a comment row's place link; kept across versions, reloads and source view.
   - `count` and `confirmed` (in `useSlideDeck`, stored with the document key `version id:reload count`): written only by the current frame window's ready and shown messages; a stored value under another key reads as unknown in the same render, so a new version or reload never shows the old count. Ready sets `confirmed` to 0 and posts the clamped `wanted`.
   - `slide` = `wanted` clamped to `count`: posted to the frame on every change.
   - `confirmed`: read by the pager's `n / N` and its disabled ends, the pins, the comment anchor, the draft reset and `data-current`.
   - Full screen: `useFullscreen` reads `document.fullscreenElement` on `fullscreenchange`; read by the pager (present hidden) and the comment reset in row 5.
   - Picked element and draft (`useCommentBridge`): written by the frame's pick message, which carries the slide the clicked element sits in; the canvas treats a pick whose slide is not `confirmed` as no pick, so neither the draft nor a retarget can use it even when the pick and a slide change land in one render; cleared by leaving comment mode, by a viewport change and by a change of `confirmed`.
   - Stuck states: until the count is known no pager shows and the frame is laid out at 1920×1080; the deck script is inline and runs before any page script can fail it, so ready follows every load. Switching to a version with fewer slides shows its last slide; switching back returns to `wanted`.
9. The task step prompt (`apps/daemon/src/step-prompt.ts`, the sentence on self-contained `.html` pages attached with `attach_file`) says a slide deck is written as `<html data-slides>` with one `<section class="slide">` per slide designed at 1920×1080, and that Cairn shows it one slide at a time with paging and present.
10. `artifact-panel.md`'s slides row names the detection rule and this viewer; the verify-cairn feature map is regenerated (`node scripts/generate-feature-map.mjs`) so the design surface lists the new test id.

Unchanged: the server, the database, comment states, sending, versions, export and share, and the panel shell (title, toolbar order).

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Detection: the mark in any case; a carousel of `section.slide` without the mark; `data-slideshow`; `data-slides` on a `div`, inside a comment, inside a quoted attribute value, or a fake `<html data-slides>` inside another tag's value | Deck only with the attribute on the document's own `<html>` start tag | `apps/web/test/slide-deck.test.ts` | this change |
| Slide comment place label in the list | `第 3 页幻灯片 · b「¥1,280 万」` | `apps/web/test/slide-deck.test.ts` | this change |
| Slide comment with a structural selector sent to the task | Task block names `第 3 页幻灯片` and the selector | `packages/shared/test/design-comment-block.test.ts` | this change |
| Deck opens | Slide 1 visible, other slides hidden, `1 / 3`, 16:9 stage, no viewport switch | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| Next, previous, keys with focus in the frame, a key typed in a field inside the slide, first and last slide | Position updates; previous disabled on 1, next on N; → inside the frame pages; → inside a field does not | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| Present with the comment list open, page with →, Esc | Deck shell is the full-screen element; the list closes; → pages; Esc reaching the page leaves the panel open; once full screen ends the panel shows the same slide | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| Browser refuses full screen | Toast `未能全屏放映`; the comment list stays open; same slide | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| Browser has no full screen | No present button | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| Present from the last slide, then ← | Focus stays in the deck; ← shows slide N-1 | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| Comment on slide 3, page back to slide 1, click the row | POST carries `anchor {type:'slide', slide:3}`; pin absent on slide 1, present on 3; row click shows slide 3 | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| Pick an element, then page before saving | The draft closes; nothing is saved against the wrong slide | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| Deck comment mode | No draw-markup tool in the comment strip | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| Comment made before the file was a deck; comment on a slide past the end | Both rows listed; no pin for the first; clicking the second shows the last slide | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| On slide 3, open an older one-slide version, then back to current (reload uses the same document key path) | `1 / 1` with that version's slide; back on current `3 / 3` | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| Source view and back | Same slide | `apps/web/e2e/artifact-slides.spec.ts` | this change |
| Raw download, print link and share link of a deck | Rendered without the deck script: every slide in page flow, as today | `apps/web/e2e/design-view.spec.ts` (deck variant not yet written) | later: slides-1b |
| PNG snapshot of a deck | Snapshot of the preview frame, which shows the current slide | `apps/web/e2e/design-view.spec.ts` (deck variant not yet written) | later: slides-1b |

Regression guards that pass on the parent by design and must stay green: the marked file with no top-level slide rendering as a page (`apps/web/e2e/artifact-slides.spec.ts`), the product page with a `section.slide` carousel (`apps/web/e2e/artifact-slides.spec.ts`), the PDF deck pager, keys and present (`apps/web/e2e/artifact-kinds.spec.ts`), today's page loading, missing, empty and source states, and the comment save and retarget failure toasts, whose mutation path decks share (`apps/web/e2e/design-view.spec.ts`).

## Out of scope

- Thumbnail rail, grid overview, long scroll, speaker notes, presenter view (owner: later).
- Adding slides, text or shapes in the panel (owner: not wanted).
- Moving toolbar actions into the title menu and a bottom comment bar (the Claude-style shell is its own change across all kinds).
- `.pptx` export, one-PDF-page-per-slide print, 4:3 decks, slide count on the chat card.
- Recognising decks that lack the `data-slides` mark (decks made outside Cairn open as pages).

## Review

- Verdict: PASS
- Plan-SHA256: ec8bb3fb559dfc9cf0f146b0e6c683d221355a00265462c4750984635a5e4fa5
- Reviewer: openai-codex/gpt-6.2-sol through pi, fresh context, three completed rounds; the owner then limited the plan to one review (ian, 2026-11-27) and the author verified the last round's five findings fixed in code and tests
- Author-Model: claude-opus-5-5
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: Every completed round returned FAIL; the PASS above is the owner's call to stop reviewing, not a reviewer verdict. Round 1: carousel false positive, frame/panel index drift, draft on the wrong slide, missing edge rows, hollow tests. Round 2: comment and quoted-value false positives, stale count, unbound picks, parent-passing rows, missing rows. Round 3: fake `<html>` inside another tag's value, pager reading the requested slide, a pick batched with a slide change, zero-slide row passing on the parent, presenting from the last slide losing keyboard focus. The author fixed each one (anchored start-tag detection, frame-confirmed `shown` in `useSlideDeck`, slide-bound picks in the comment bridge, regression-guard list, focus on the deck shell) and added the tests named in the edge table. Two other rounds timed out without a verdict and a last one was stopped on the owner's call. After review, `main` retired the info-card brief that row 9 first edited; the author moved the instruction to the step prompt's existing `.html` sentence.
