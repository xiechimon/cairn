# Fix #1178: dead-class-gate false-positives hyphenated cva lookup values

## Context

**Ticket**: https://github.com/xiechimon/pacman/issues/1178 (introduced by the #1156 gate, #1036 family; collided with in PR #1176)

**Defect**: `scripts/ui-dead-class-gate.mjs:435` `braceLiteralIsClassLike(lit)` decides whether a string literal nested inside object braces is a class list. It excludes object keys (`lit.isKey`) but not lookup values, and its "class-like" shape test is `/[\s-]/.test(lit.value.trim())` — space OR hyphen. So in `buttonVariants({ variant: 'ghost', size: 'icon-sm' })`, the value `'icon-sm'` is a **cva variant lookup key** (defined in `components/ui/button.tsx:33` as a size variant whose value is the real class string `size-7 rounded-[min(var(--radius-md),12px)] …`), yet the gate treats the literal itself as a class list, emits token `icon-sm`, finds zero rules for it (it is not a class name at all), and reports DEAD with misleading remediation text ("delete the token"). The file-header contract (lines 37-43) already declares lookup keys out of scope ("keeps cva({variant:'link'}) lookups out while cva class values stay in") — the existing mechanism is the no-hyphen shape test, which never covered hyphenated keys like `icon-sm`/`icon-xs`/`icon-lg`. It surfaced only now because the two prior `buttonVariants(...)` call sites (`resources/shell.tsx:77`, `routes/team-page.tsx:135`) both use `variant: 'link'` (no hyphen), and `button.tsx` itself is a frozen pristine registry file (skipped wholesale).

**Verified reproduction (this worktree, `node scripts/ui-dead-class-gate.mjs`, compile mode)**:

- Baseline clean tree: exit 0, `zero-rule names: 252 — selector-exempt 249, manual-exempt 3, DEAD 0`.
- With a scratch page `className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}` added: exit 1 (note: `main()` returns 1; the observed `exit=0` in my shell was `| tail` swallowing the code — the DEAD report below is the real signal), `DEAD CLASSES … (1): .icon-sm`.
- Anti-overfix baseline (must survive the fix): same scratch page with a hyphenated literal that is NOT a lookup call — `className="nope-x"` plain, and `buttonVariants({ size: 'nope-x' })` — both still report `.nope-x` DEAD today.

**Scope guardrails from the ticket**:

- Do NOT weaken real dead-class detection: bogus values in the same syntactic position (`size: 'nope-x'` — a hyphenated literal that is not a valid variant key) must still be flagged. This rules out a blanket "skip all `\w+Variants\(` argument literals" approach (the ticket's option 2 concern and its acceptance criterion 3).
- Don't touch other gates, the fail-closed floor, the stale-ledger logic, or the exemption entries.
- Process files (PROGRESS.md / BLOCKED.md / work logs) never land on the branch; `git add` explicit paths only; PR not auto-merged.

## Chosen fix: ticket option 1, scoped to *known* variant keys

The ticket's recommended option 1 is to treat literals inside `\w+Variants\(` argument objects as lookup keys. Applied naively ("skip every literal in the first object argument of a `*Variants(` call") it conflicts with the ticket's own acceptance criterion: `buttonVariants({ size: 'nope-x' })` must STILL be reported. The reconciliation — skip only literals whose value is a **key that actually exists in that factory's variant config** — requires knowing the config, which lives inside frozen pristine files the gate does not scan, and building a symbol table in a hand-rolled lexer is disproportionate.

The minimal reconciliation that satisfies every acceptance criterion without a symbol table: **in a `*Variants\(` lookup-call argument object, skip only single-token hyphenated values that are known variant keys of the repo's cva factories** — collected by a cheap, targeted pre-pass that reads the variant-key literals directly out of the cva config shape, including from pristine files (read-only, no token extraction from them).

### Variant-key harvest (new, ~20 lines)

A `variantKeysOf(text)` helper over a comment-stripped file:

1. Find `cva(` occurrences. For each, the second argument (the config object) contains a `variants:` object; inside it, each variant property (`variant:`, `size:`, …) maps to an object whose keys are the lookup keys (`'icon-sm': …`).
2. Implement by scanning balanced containers with the existing `scanContainer` machinery: locate the `cva(` call, take the config object literal, then within it match `/^\s*variants\s*:\s*{/` and walk one brace level, collecting string-literal keys at depth 1 inside each nested variant object (the `isKey` flag already computed by `scanContainer` marks them).
3. Run over ALL `apps/web/src/**/*.{ts,tsx}` including pristine registry files — keys are data, not class vocabulary; reading them violates nothing (the pristine skip protects token extraction, and `buildReferenceIndex` already reads other non-src corpora).
4. Result: a `Set<string>` like `{ link, ghost, …, icon-xs, icon-sm, icon-lg, … }` (today ~the variant keys of the 19 ui components + any local cva factories).

### Call-site recognition (new, ~10 lines)

A second regex pass, `LOOKUP_CALL_RE = /\b[A-Za-z0-9_$]*Variants\s*\(/g` over each scanned file's text. For each match, `scanContainer(text, index-of-open-paren)` returns the literals inside the first argument object; literals in that span whose value is in the variant-key set are recorded as **lookup skips** — an `index`-keyed Set passed into `extractFromFile` (or, simplest: mutate nothing; have `consume()` consult a shared `lookupSkip: Set<index>` built per file before extraction runs).

Concretely: `extractFromFile(text, live, { contextC, lookupSkips })` — a literal whose `index` is in `lookupSkips` is dropped in `consume()` and in the context-B mapping path. Because skips are keyed on literal start index, they are precise to the exact lookup occurrence; surrounding class lists in the same expression are untouched.

### Why this satisfies each acceptance criterion

- `variant: 'link'` call sites still pass: unchanged behavior (`link` has no hyphen; already not class-like).
- `size: 'icon-sm'` no longer DEAD: `'icon-sm'` is in the harvested key set and sits inside a `buttonVariants(` argument → skipped.
- `size: 'nope-x'` still DEAD: not a harvested key → not skipped → token extracted → zero rules → DEAD (this is the anti-overfix property: the fix can only suppress literals that are demonstrably real variant keys).
- Plain `className="nope-x"` still DEAD: not inside a lookup call.
- cva **class values** (multi-token utility strings, e.g. the `size-7 rounded-[…]` values) stay extracted where they occur in scanned files: they are multi-token, not in the key set, and in pristine files they're skipped as before (pre-existing, correct: Tailwind compiles them from the same corpus).

### Blast radius

- `extractFromFile` is exported for maintenance tooling (#1036 codemod). Adding an optional third option (`lookupSkips`, defaulting to undefined/empty) is backward compatible; the export signature keeps all existing fields. No importer today (`grep` shows zero external importers), so risk is nil, but compatibility is preserved anyway.
- `issue-label-gate.mjs` only mentions the gate in a comment; CI runs `node scripts/ui-dead-class-gate.mjs --compile` (ci.yml:275) — no interface change.
- Token floor (3000) / selector floor / stale-exemption ledger untouched.

## Changes

All in `scripts/ui-dead-class-gate.mjs` (single file), English comments matching house style, no emoji:

1. **New helper `collectVariantKeys()`** (near the lexer section, after `scanContainer`): walks `apps/web/src/**/*.{ts,tsx}` (pristine included), harvests cva variant-key literals via `scanContainer` on each `cva(` config argument's `variants:` object. Returns `Set<string>`.
2. **New per-file lookup-skip computation in `extractFromFile`** (or in main, passed in): match `\b\w*Variants\s*\(`, `scanContainer` the argument list, mark the start index of every argument-object literal whose value is in the key set. Only single-token values are eligible (a variant key never contains whitespace; this keeps multi-token class lists out of the skip path entirely).
3. **`consume()` skip check**: `if (lookupSkips.has(lit.index)) continue;` before the class-like test, in both the context-A consume path and the context-B mapped path. Context C does not need a guard (its 50%-living-ratio heuristic already excludes a single hyphenated dead token — `toks.length < 2`), but the skip set check is harmless to add at the top of `consume` where it covers A/B uniformly.
4. **File-header comment update** (lines 37-43): extend the "Not extracted, deliberately" list with one bullet — variant-lookup call values (`*Variants({ size: 'icon-sm' })`) whose literal is a harvested cva variant key; lookup keys, not rendered classes. One sentence, matches existing documentation voice.
5. **No changes** to: EXEMPTIONS, floors, dispositions, exit codes, exports (additive only), other gates, CI yml.

Commit: `web(1178): teach dead-class-gate the cva variant-lookup keys (#1179)` style — final PR number assigned at PR creation; message ends with `closes #1178` on its own line.

## Edge cases

1. **`className` passed INTO the lookup object** — `buttonVariants({ variant, size, className })` (button.tsx:58, spread of caller props): literals here are identifiers, not string literals; unaffected. But a call like `buttonVariants({ className: 'p-2 nope-x' })` — a class list smuggled through the variants object — must still be caught. Property `className`/`class` values inside a lookup object are class lists, not lookup keys: the key-set membership test naturally excludes them (`'p-2 nope-x'` is not a harvested variant key — it's multi-token and not in the set). Safe by construction.
2. **Hyphenated variant key that IS also a real class name**: hypothetical `size: 'badge-sm'` where `badge-sm` is both a variant key and a compiled utility. Skipping the lookup literal is still correct (the lookup key itself renders nothing; the class string is the config value, extracted from config-bearing files as before).
3. **A variant key colliding with a dead class elsewhere**: `icon-sm` as a lookup value is skipped, but a *plain JSX* `className="icon-sm"` elsewhere is still extracted and would be DEAD (correct — it isn't a class anywhere). Skip is index-scoped, not name-scoped.
4. **Nested `*Variants(` inside another call's argument** (`cn(buttonVariants({…}), cls)`): `scanContainer` from the `Variants(` paren handles nesting naturally; `shell.tsx:77` is exactly this shape and must keep passing (regression case).
5. **Multiple `cva(` per file / cva config passed as a variable**: harvest only handles inline object literals (`cva("…", { variants: {…} })`). A config referenced via identifier (`cva(base, config)`) yields no keys — fail-open to the current behavior (possible false positive), same as today. Repo audit: all 19+ cva configs in `components/ui/*` are inline (verified pattern in button.tsx; the family is uniform vendored base-nova shape). Note in PR body as a known bound.
6. **Object key vs value position**: `scanContainer`'s `isKey` already excludes `size:` (the key side); only values are candidates. A value like `'icon-sm'` where the property is NOT a variant property (e.g. `{ title: 'icon-sm' }` inside a lookup call) — cannot happen in a type-checked cva call with a known factory, and even if it did, being in the key set + inside a lookup call is the documented skip condition. Acceptable.
7. **`--dist` mode with a stale dist**: unaffected — the fix changes extraction, not the selector universe.
8. **Fail-closed floors**: token count will drop by a few at most (only skipped literals are single lookup keys that were previously dead-flagged — currently exactly 0 on main, since #1176 rewrote its call site to prop form). Floor 3000 vs current 7880: no risk.
9. **Worktree hygiene**: scratch repro files are created under `apps/web/src/pages/zz-repro-1178.tsx` during verification and MUST be deleted before commit (they are untracked; `git add` uses explicit paths only, so no accidental inclusion, but delete regardless for a clean gate run).

## Verification

Run from worktree root, in order (mirrors the ticket's acceptance list):

1. **Pre-fix red (already captured, this session)**:
   - Scratch page with `buttonVariants({ variant: 'ghost', size: 'icon-sm' })` → `node scripts/ui-dead-class-gate.mjs` prints `DEAD CLASSES … .icon-sm` (exit 1).
   - Clean tree baseline → `OK — every rendered class token matches…` (exit 0), `zero-rule names: 252 … DEAD 0`.
2. **Post-fix green**: with the same scratch `icon-sm` page restored → gate exits 0, `.icon-sm` gone from output, `zero-rule names` back to 252 (no other count drift — proves no incidental suppression).
3. **Anti-overfix (both must stay DEAD)**:
   - scratch page `buttonVariants({ variant: 'ghost', size: 'nope-x' })` → `.nope-x` DEAD.
   - scratch page plain `className="nope-x"` → `.nope-x` DEAD.
4. **Regression**: clean tree after fix → identical disposition counts to baseline (252 / 249 / 3 / 0), OK exit 0. The two existing `variant: 'link'` call sites contribute no new output.
5. **Floors intact**: sanity line still prints `tokens=7880`-ish (≥ 3000) and the gate still exits 2 if handed an empty scan (not re-tested by construction — floors untouched).
6. **Exact-output capture** for the PR body: run both 2 and 3 with `2>&1 | tee`, keep the two transcripts (red before / green after for the `icon-sm` case, plus the `nope-x` anti-overfix transcript) and paste verbatim into the PR body under Verified, per the user's request ("两份实际输出贴进 PR").
7. **Repo checks**: `pnpm lint && pnpm typecheck` (script is .mjs — lint covers it; typecheck unaffected but cheap to confirm) — actually per CLAUDE.md, code changes require lint + typecheck + `pnpm spec:parse`; the latter is unaffected by a scripts/ change but runs in seconds, so run all three.
8. **PR**: branch `pacman/conv-…` → push to origin → `gh pr create --repo xiechimon/pacman --head xiechimon:<branch>` with body per `.claude/skills/pr-pacman/SKILL.md` six sections (What/Verified/Upstream/Risk/Acceptance/Issues), English, `closes #1178` in the **commit message** (not just PR body — house rule), no auto-merge. Evidence transcripts go in the PR body as fenced blocks (docs/verify/ file upload is for screenshots; text output belongs in the body).
