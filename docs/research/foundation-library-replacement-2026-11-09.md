# Foundation library replacement

Date: 2026-11-09
Status: In progress; diff and skill YAML adapters implemented locally; remaining domains are not accepted or complete

Tracking: #3564. This is an implementation coverage ledger, not a claim that all replacements have shipped.

## Scope and assumptions

Keep business decisions, authorization and permanent-error classification in Cairn. Libraries own format parsing and generic algorithms. Do not import a transitive package without declaring it directly. A dependency being installed does not authorize a manifest or lockfile change. Do not replace the concurrent OTel migration.

No background-agent tool is available in this thread; the primary-source inspection below was performed directly.

## Overlap

1. The Coordinator's intake found issues #3137 (emulators) and #1809 (Mermaid), and PR #3487 (Android design), not equivalent deliveries. This thread found #3564, the exact task issue, and reuses it.
2. New title/body searches of open issues, open PRs and PRs merged in the preceding seven days found #3566 (`docs/otel-sdk-migration`) and #3568 (`shared/otel-sdk-bridge`). Their OTel migration is the same intent for the exporter portion. Wait for and extend that work rather than compete. Preserve #3075, #3470, #3261, #3292 and #3283.
3. Diff alternatives `unified diff` and `diff parser`: open issues, open PRs and recent merged PR results were all empty. Exact planned-file inspection found #3494, head `cairn/conv-01a1bd80-7b0d-7e1d-bed9-7c4c34defb5a`, touching `apps/server/src/services/git.ts`. Its patch changes repository binding and `readFile`, not `parseUnifiedDiff`. Proceed with the disjoint parser-only change; retain its auth and subscription work.
4. Parsing searches (`frontmatter`, `shell splitting`, `encoding`) found #3564 plus unrelated #1667 and #1571; open and recently merged PR results were empty. File-level checks for these future segments remain pending.
5. Main Markdown research and merged #2996/#3473, plus redaction #2736/#3348, are inherited, not reverted. Other domains have not yet received complete file-level conflict verification and must not be represented as conflict-free.

6. YAML exact-file checks found #3568 touching the shared manifest and lockfile with unrelated OTel additions, and #3528 (`web/unslop-signs`) changing only the skill empty-label punctuation. Proceed additively: no overlapping dependency names, parser bodies or labels. Exact checks for the skill server test, skill-write browser spec, delivery test and machine finish service returned no file overlaps.

The first large OR query returned 422; narrower queries avoid the GitHub search query-length constraint. The default gh identity subsequently returned 403 with an explicit rate-limit reason. Existing App-authenticated reads work. No token was printed, copied or persisted.

## Coverage and acceptance ledger

| Domain | Observed path / dependency | Next acceptance or retained boundary | Status |
|---|---|---|---|
| GitHub pagination, retry, throttling | `apps/server/src/lib/github.ts`, `github-review-findings.ts`, `scripts/lib/github-create-gate.mjs` | Inspect both Link readers and all classifiers; evaluate official Octokit pagination/retry/throttling against injected fetch and enterprise base URLs. Never replay unauthorized requests or ambiguous writes. | Inventory started; no replacement claimed |
| Langfuse export | `packages/shared/src/otel.ts`, server `runtime-otel.ts`, daemon `backend/otel.ts` | Follow #3566/#3568 and the runtime follow-up #3567. Verify bounded queue, flush, full queue, exporter failure visibility, stable trace IDs and permanent failures. Outcome/export ruler paths must remain untouched. | Existing migration owns implementation |
| Markdown | `apps/web/src/detail/chat-markdown.tsx`; [main research](chat-markdown-polish-2026-11-08.md) | Preserve tables, measured lists, code/copy behavior and attachment authorization. Add emphasis, links, escaping and dangerous-scheme tests before selecting a parser. | Inventory started |
| HTML entities and safety | daemon `backend/web-search.ts`: six-entity decoder, regex text extraction, handwritten address classification | Separate text extraction from SSRF prevention. Test numeric/named entities, raw-text elements, IPv4-mapped IPv6, DNS and every redirect. A decoder is not an SSRF fix or sanitizer. | Confirmed handwritten paths; library research pending |
| Skill frontmatter | shared `records/skill.ts` feeds server `skills.ts` and `skill-import.ts`; direct `yaml@2.9.0` approved in this thread | YAML AST reads and library serialization replace regex metadata parsing and interpolation. Tests cover block scalars, quoting, comments, BOM/CRLF, duplicate keys, scalar aliases, recursive collections and round trips. Identity, file permissions and size limits remain caller-owned. | First implementation segment |
| Time zones and yesterday | server `schedules.ts`, `chief-report.ts`, `lib/snooze-time.ts`; web `schedules/schedule-model.ts` | Inventory all wall-clock converters and report boundaries, then test DST folds/gaps, half-hour offsets and non-UTC+8 yesterday. Formatting with Intl is not itself a duplicate converter. | Inventory started; no fixed-offset conclusion yet |
| Outbound secret redaction | shared `secret-redaction.ts`; server and daemon OTel callers use `redactSecrets` | Preserve #2736/#3348, add synthetic AWS/Slack/private-key cases at outbound boundaries. Evaluate detectors separately from structured logger key redaction. No real keys in fixtures. | Callers confirmed; research/tests pending |
| QR code | web `lib/qr-code.ts`, versions 1–10 | Evaluate maintained encoder with versions through 40; test long Unicode payloads using an independent decoder, retain matrix API. | Confirmed handwritten encoder; replacement pending |
| Jittered backoff | daemon `machine-client.ts`, `backend/pi-retry.ts`; server `tsnet-sidecar.ts`, `due-events.ts`, `quota-wait.ts`, `task-issue-sync.ts` | Enumerate lifecycle readers/writers before implementation. Preserve cancellation, server Retry-After, attempt caps and permanent model failures. Reconnect jitter must not become blind request retry. | Candidate sites identified; not a complete six-site audit |
| Command splitting | daemon `computer/guard-shell-parse.ts`, `backend/command-gate.ts`; transitive `shell-quote` 1.9.0/1.12.0 | Verify token/operator/env/glob/error behavior and every guard consumer. A tokenizer cannot replace the command authorization policy. | Inventory started; no replacement approved |
| Diff | server `services/git.ts`; existing direct `diff` dependency, installed 9.0.0 | Replace text parser, test header-like content, quoted names, standard unified format, deletion/multiple files and metadata-only display policy. Keep changed-file detection separate from text display. | First implementation segment |
| SSE | shared `protocol/sse.ts`, daemon `machine-client.ts`, web stream hooks; transitive `eventsource-parser@3.1.1` | Separate schemas from wire parsing; test split UTF-8 and CRLF chunks, comments, multiline data, IDs, auth and reconnect semantics. Do not replace the schema with a parser. | Paths identified; full reader inventory pending |
| Encoding | daemon `computer/host-screen-png.ts`; native TextDecoder/Buffer elsewhere | Identify custom codecs before choosing replacements. Native strict UTF-8 decode is already a standard implementation; PNG codec suitability needs source/round-trip and size-bound checks. | Candidate paths, not an exhaustive inventory |

## First segment: jsdiff

| Primary source | Observation | Trade-off / recommendation |
|---|---|---|
| [Installed jsdiff 9.0.0 README](https://github.com/kpdecker/jsdiff/blob/v9.0.0/README.md), `libesm/patch/parse.js` and `types.d.ts` | `实测` (Read): `parsePatch` distinguishes body lines from file headers, unquotes Git file names including UTF-8 octal escapes, validates hunk counts and exposes structured hunks. | Use the existing direct server dependency. Retain only conversion to Cairn's display record, not a second parser. |
| [jsdiff repository](https://github.com/kpdecker/jsdiff), GitHub repository metadata read 2026-11-09 | `实测` (Read): not archived; last push 2026-11-04; BSD-3-Clause. Installed package declares Node >=0.3.1 and provides ESM/types; Cairn requires Node >=22.19.0. | `推断` (Inferred): compatible with Cairn's existing ESM import and license distribution. No new package, version change or lockfile needed. |
| [GHSA-73rr-hh4g-fpgx](https://github.com/kpdecker/jsdiff/security/advisories/GHSA-73rr-hh4g-fpgx) | `实测` (Read): published parsePatch DoS affects 6.x–8.0.2 and older branches; patched in 8.0.3 (and maintained older branches). Installed 9.0.0 is outside the listed ranges. | Do not downgrade to vulnerable releases. This check is not a guarantee of absence of unknown vulnerabilities. |
| [Git patch format](https://git-scm.com/docs/diff-format#_generating_patch_text_with_p) and installed parser source | `实测` (Read): Git metadata differs from hunk content; the library adjusts start positions by one for zero-length ranges. | Keep Cairn's display coordinates by reversing that documented library representation adjustment, and exclude no-newline markers as before. |

The retained adapter has concrete responsibilities: choose old path for deleted files, strip Git's a/b path prefixes, count actual added/deleted display lines, format the existing hunk header and exclude metadata-only changes from the text view. `diffTextNamesAFile` remains the separate Git change-presence policy, so binary/rename-only changes still count as work even though they have no display hunks. No file access or permission boundary changes.

### Test plan and evidence

- Before changing behavior: `pnpm exec vitest run apps/server/test/unified-diff.test.ts`: three failures and two passes. Failures demonstrate overwritten paths/missing content for header-like body lines, undecoded quoted names and ignored standard unified patches.
- Run the new adapter tests plus `git-hosting.test.ts` and `build-diff-fulltext.test.ts` for real Git/HTTP compatibility.
- Initial lint, typecheck, spec parsing and prepush passed. Leave injected `AGENTS.md` unstaged. The initial unrelated toolchain lockfile change disappeared after pnpm execution; current lockfile diff is only the approved three-line YAML importer entry.
- `pnpm exec vitest run --changed` with the seven affected existing test-file filters: 140 passed. The new `unified-diff.test.ts` was run separately: 9 passed (untracked tests are excluded by `--changed` until staged).
- `pnpm --filter @cairn/web e2e:affected apps/web/e2e/skills-write.spec.ts apps/web/e2e/skill-import.spec.ts apps/web/e2e/project-commit-detail.spec.ts`: 17 passed. This uses a real browser and compiled web output; API routes in these specs are stubbed, not production acceptance. Default affected selection would run all 218 specs, so full-suite execution is left to CI.
- Final lint, typecheck and spec parsing passed after the code/browser-test changes. Prepush passed all 23 fast checks; CI and fresh cloud review remain required and are not claimed here.
- Recheck all planned files against open PRs before publication.

### Decisions

| Decision | Reason | Verification |
|---|---|---|
| Reuse `diff@9.0.0` | Already direct, maintained parser with typed ESM API and a checked published advisory. | Regression tests and Git/HTTP tests above. |
| Do not rewrite trajectory outcome diff parsing in this segment | `trajectory-outcome-backfill.ts` participates in the protected evaluation outcome ruler; this task explicitly prohibits changing it. | Path remains untouched; report separately if that parser needs work. |
| Add only the explicitly approved YAML dependency | Owner approved exactly `yaml@2.9.0` in shared and corresponding lockfile changes. No other package addition is authorized. | Offline install produced only a three-line shared importer addition; no package versions or toolchain entries changed. |

## Skill YAML source review

| Primary source | Observation | Decision |
|---|---|---|
| [yaml README at v2.9.0](https://github.com/eemeli/yaml/blob/v2.9.0/README.md), installed `dist/nodes/Alias.d.ts`, `dist/options.d.ts` and implementation | `实测` (Read): YAML 1.2 parsing, typed document AST, scalar/alias predicates and stringify are public APIs; Node and browser builds are supplied. | Use the document AST, not whole-document `toJS`, to read only string metadata. Scalar aliases resolve once; collection aliases are not expanded. No arbitrary object deserialization or custom tags. |
| [yaml repository metadata](https://github.com/eemeli/yaml) read 2026-11-09 | `实测` (Read): ISC, not archived, last push 2026-09-23. The installed version is already in Cairn's dependency graph. | `推断` (Inferred): the exact existing version avoids introducing another YAML implementation and supports shared browser/server consumers. Direct declaration is still necessary. |
| [GHSA-48c2-rrv3-qjmp](https://github.com/eemeli/yaml/security/advisories/GHSA-48c2-rrv3-qjmp) | `实测` (Read): deeply nested collection parsing could throw RangeError before 2.8.3 (and in older 1.x). Version 2.9.0 is outside the listed vulnerable ranges. | Pin 2.9.0, keep the input bound, reject document errors/warnings, and never recursively materialize alias collections. Unknown vulnerabilities remain possible. |

The only retained regex recognizes the Markdown frontmatter fence, not YAML keys or values. One constant serves parse and split. Library stringify now quotes colon/hash/quote-sensitive values rather than making legal descriptions impossible to round-trip. Invalid metadata still returns the existing empty/partial metadata shape; write/import callers retain their existing validation errors and scan retains its directory-name fallback. Duplicate keys, unsupported tags and malformed documents cannot supply an identity.

Tests were written before the parser change: 11 failed and 14 passed. The existing server test explicitly expected valid folded scalars to be discarded; it is updated to the requested YAML behavior. The browser test now expects quoted descriptions to be submitted losslessly while still refusing invalid directory names. No UI component or authorization code changes.

## Diff failure boundary

Library hunk validation can reject malformed input, unlike the old permissive loop. The machine done handler must parse an in-limit diff after ownership validation but before credential revocation, GitHub reads, merge effects, checkpoint/session writes or build writes. On failure it returns a constant 400 reason without echoing content. No retry is performed. Existing over-limit handling, already-terminal idempotency and authorization precede or retain their existing behavior.

| Entry path | Expected behavior | Test |
|---|---|---|
| Claimed step, malformed in-limit patch | 400; step, build and API-key rows unchanged; corrected report still accepted | `delivery-surface.test.ts`, malformed diff case |
| Claimed step, valid patch | Existing changes projection and completion | Existing delivery tests |
| Empty patch | Reported empty change list | Existing delivery test |
| Rename/binary metadata only | No invented display hunks; change-presence detection retained | Unified diff and delivery tests |
| Over-limit patch | Existing omission policy; completion succeeds | Existing delivery test |
| Wrong machine / terminal report | Existing ownership and idempotency branches, before new parsing | Handler ordering unchanged |

The new boundary regression first returned 500, demonstrating the adapter's error reached the mutation path. Parsing is moved before mutations and the test verifies 400 plus unchanged rows. No persisted schema, wire fields or new lifecycle states are introduced. Protected `machine-finish-step.ts` requires the human checkpoint and cloud review; no auto-merge is authorized by this note.

