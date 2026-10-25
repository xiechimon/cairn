# 07 · streamdown introduction evaluation (W4 #290 — evaluation only, no implementation)

> Status: **an evaluation draft, not ruled**. This volume = the output of volume 05 §6.3's follow-up ticket ("streamdown belongs to a follow-up-ticket evaluation — introducing it means a DOM-contract change requiring matrix re-verification"), for the product owner's morning ruling.
> Red line: this volume accompanies zero code changes.

## 1. What streamdown is

[External knowledge · unverified] streamdown = Vercel's open-source streaming-markdown renderer (React), designed for LLM streaming output: unclosed code blocks / tables / lists render mid-stream without jitter (partial-markdown fault tolerance),
built-in component styles, math (KaTeX), and a typewriter animation. A typical consumer = Vercel's AI chatbot template. **Before introduction, verify the current version / license / dependency surface online** (see the §6 verification checklist).

## 2. What it would replace (measured, the in-repo status quo)

This repo's transcript rendering = a **self-built segmented renderer** (05 §6.3):

- `apps/web/src/detail/transcript.tsx` (272 lines) + `segments.tsx` — rendering by the `TranscriptItem`
  segmentation model: user rows / robot `paragraphs[].segments[]` (inline-style code/link) /
  bullet / footer.seconds / note / fail cards;
- the data model = **the same presentation surface** in fixture and live modes (the fixture transcript paragraph records
  and the final messages uploaded by the daemon go through the same mapper projection) — this is the foundation of the parity pixel contract.

## 3. The DOM-contract change surface (what changes on introduction)

1. **The segmentation model gives way**: streamdown consumes a **plain markdown string**, not this repo's
   `paragraphs/segments` record model. After introduction, either (a) unify the message content side into a
   markdown string (double-changing the mapper/fixtures), or (b) a segmentation-model→markdown serialization bridge
   (a dual-source truth, a long-term tax).
2. **The pixel contract re-verified in full**: the transcript DOM structure is wholly replaced — among the parity full matrix's 174 rows,
   **every row carrying a conversation surface needs re-baselining** (except the empty board state; estimated 60–90 rows, covering the 16/17/26/27
   detail family + the chief surface family). Re-baselining = a one-time cost (the #109 form), but **thereafter the fixture
   transcript record model decouples from the DOM** (the fixture surface migrates from "segmented records" to "markdown strings").
3. **The streaming surface**: the current text_delta writes `liveTextStore` directly (plain-text append); streamdown's
   partial-markdown streaming rendering could replace this surface — the payoff sits mainly here.

## 4. Cost and benefit

| | Estimate |
|---|---|
| Introduction cost | the mapper/fixtures double-side model rework + re-baselining 60–90 parity rows + aligning component styles to the tokens.css theme (light/dark dual states) + the bundle + (streamdown + dependencies, [external knowledge] on the order of ~50–100KB) |
| Benefit | rich markdown (tables/headings/math) + streaming partial fault tolerance (the current renderer has no surface for unclosed structures) + one less self-built renderer to maintain |
| The cost of not introducing | the rich surfaces stay missing (tables/math do not render as structures); the streaming surface stays plain-text append (usable as-is) |

## 5. Recommendation (the evaluator's position, not a ruling)

**Defer the introduction.** Reasons:
1. Volume 05 positions pacman as an autonomous product — there is no real-usage-feedback-driven
   demand evidence for transcript rich markdown (the replication-period pixel contract is lifted, but "users want table rendering" has not emerged);
2. Introduction means a re-baselining batch across the 174-row matrix + a fixture-model migration — a large one-time cost smashed onto a surface with no measured demand;
3. **The recommended trigger line**: reopen it when real usage produces complaints about "pasting markdown tables / long documents" or evidence that the chief routinely produces rich documents — and then go live-surface-first (parity rows re-baselined in batches per the #109 form, no one-shot cutover).

## 6. If the ruling is to introduce — the verification checklist (step one of the morning)

- [ ] streamdown's current version / license / dependency tree / measured bundle (verified online via agent-reach)
- [ ] the co-stack surface with React 19 / Tailwind 4.3.3
- [ ] the theme-alignment plan for tokens.css dual states (light/dark)
- [ ] the segmentation-model → markdown-string migration strategy (the fixtures record model migrates along)
- [ ] the row list and order of the parity re-baselining batch (the #109 rebaseline form)

## Ruling slot

Left to the product owner (morning of 2026-09-26): introduce / defer (recommended) / adjust the trigger line.
