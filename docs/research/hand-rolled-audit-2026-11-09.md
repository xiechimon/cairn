# Hand-rolled implementations audit

Publication note: restored historical research, with private details redacted. Evidence labels describe the original research session; recommendations are not implementation approval or current policy.

Scope: apps/server, apps/daemon, apps/web, packages/shared at `origin/main` (read with `git show`/`git grep`, no code changed). Library facts (version, last publish, license, unpacked size) come from `npm view` run on 2026-11-08 (measured). Labels: **checked** = I read the code; **inferred** = deduced from names, call sites or library behavior, not verified by running. Bug history = `git log --grep` on the file (subjects only, so "known bug" means a fix commit exists, not that I proved the root cause).

Seams respected: `biome.json` locks `@earendil-works/*`, MCP SDK, claude-agent-sdk, ACP SDK, `cron-parser` (Scheduler seam, used correctly in `services/schedules.ts`), `simple-git` and `isomorphic-git` (both prohibited: GitOps is a thin wrapper over system git), `e2b`, and `@opentelemetry/*` (bridge `apps/daemon/src/backend/otel.ts` only). Wrapping is fine; none of the findings below argue against a seam.

Total: 19 findings (sorted by risk x size) plus 11 justified hand-rolled pieces.

## Findings

### 1. GitHub REST client, rate limiting, pagination, ETag, create throttle (checked)
- Where: `apps/server/src/lib/github.ts` (2319 lines, 47 commits, 19 fix-ish), plus `github-reads.ts`, `github-issues.ts`, `github-recovery.ts`, `github-autonomy-brake.ts`, `merge-gate/github-facts.ts` (694), `services/skill-import.ts` (raw fetch + recursive tree), daemon `github-probe.ts`, shared `github-create-gate.ts` (132). Roughly 3k lines are client plumbing; the rest is gate logic.
- Re-implements: auth headers, `per_page`/`page` loops, `Link: rel="next"` parsing (two separate implementations: `includes('rel="next"')` at github.ts:607/705 and `nextPageUrl` regex at :997), ETag conditional GET (`conditionalGetJson`, `intakeGet`), primary and secondary rate-limit detection (three copies: `isRateLimited`, `rateLimitOf`, `parseGithubCreateRateLimit` in shared), retry with `2 ** attempt` (github.ts:1412), timeout mapping.
- Replacement: `@octokit/core` 7.0.8 (MIT, 22 KB, published 2026-08) + `@octokit/plugin-throttling` 11.0.5 (43 KB) + `@octokit/plugin-retry` 8.1.1 (17 KB), optionally `@octokit/plugin-paginate-rest`. All actively maintained. Octokit accepts a custom `request.fetch`, so the injected `FetchLike` test seam survives. Needs a new bridge module, like the other seams.
- Bugs caused: #1833 (throttle creates across REST and bot CLI), #1496 (intake follow-ups), #2103 (linked-PR read adapters), #1503/#1509 (merge gate transport). Rate-limit handling was reinvented three times after the first miss.
- Risk/benefit: high benefit (one rate-limit/pagination/retry implementation, typed endpoints). Medium risk: 25+ call sites, error mapping to `HttpError`, merge-gate reads are security-relevant, so migrate read-only endpoints first. The cross-process file gate (`github-create-gate.ts`) is not covered by Octokit and stays, but shrinks to a `before-request` hook.

### 2. OpenTelemetry tracing built as hand-made OTLP JSON (checked)
- Where: `packages/shared/src/otel.ts` (252), `apps/server/src/runtime-otel.ts` (369), `apps/server/src/trajectory-otlp.ts` (178), `apps/daemon/src/backend/otel.ts` (191, the "bridge" that imports no `@opentelemetry` package: no `@opentelemetry/*` is in any package.json, measured), plus `trajectory-push.ts`, `trajectory-shadow.ts`, `trajectory-failure-replay*.ts`.
- Re-implements: span/attribute/resource encoding (`otlpAttributes`, `otlpTracesRequest`), nanosecond timestamps, `traceparent` string, endpoint/header env parsing (`parseOtlpTarget`: only `CAIRN_OTEL_*`, ignores standard `OTEL_EXPORTER_OTLP_*`), a fetch-based exporter with a concurrency-4/queue-64 sender that silently drops (`createOtlpSender`, no retry, no batching, no gzip, fixed 5 s timeout).
- Replacement: `@opentelemetry/sdk-trace-base` 2.12.0 (Apache-2.0, 120 KB, 2026-10) + `@opentelemetry/exporter-trace-otlp-http` 0.301.0 (40 KB, 2026-11) (+ `sdk-trace-node` 2.12.0 for context). Maintained by the CNCF project. The biome rule already reserves the bridge for exactly this.
- Wrinkles (inferred): IDs are derived deterministically from build/step ids (sha256) so server, daemon and trajectory replay agree on trace ids; the SDK generates random ids, so the replacement needs a custom `IdGenerator` or explicit `SpanContext` parents. `packToOtlp` (replay of stored trajectories with historical timestamps) needs `startSpan({startTime})` and `end(endTime)`; both supported. The Claude CLI already speaks standard OTel env, which the hand-built target parser has to translate.
- Bugs caused: no encoder-level bug found; fixes are all attribute content (#3470 cost attribute, #3261 failure reason, #3292 live exporter leaking into pi steps, #2300 CLI export block). Real gap: failed exports are dropped with no retry or visibility.
- Risk/benefit: medium effort (about 1k lines out, about 300 in), low behavioral risk if ids stay deterministic; benefit mostly in not owning an encoder and gaining retry, batching, standard env vars and metrics/logs later. Owner's complaint is valid.

### 3. Markdown subset parser for chat, plans and docs (checked)
- Where: `apps/web/src/detail/chat-markdown.tsx` `parseChatMarkdown` and table helpers (lines 37-260, 26 commits, 10 fix-ish), `apps/web/src/api/mappers.ts` `inlineSegments` (:385) and `mapPlanDoc` (:440+; mappers.ts has 107 commits, 45 fix-ish but mixed concerns), `overlay/mention-display.ts`.
- Re-implements: block parsing (fences, headings, ordered/bullet nesting by indent, task lists, GFM tables, `expandCollapsedTableLine` for malformed model output) and inline parsing (backticks, `**` pairing with a delimiter budget, mention links). No italics, links, autolinks, escapes, strikethrough, blockquotes, nested emphasis.
- Replacement: `marked` 18.1.3 (MIT, 545 KB, published 2026-11-02; `marked@18.0.11` is already in the lockfile transitively, measured) with a custom renderer or token walk into the existing React components, or `micromark` 4.0.3 / `mdast` pipeline. Mentions and task cards become small extensions.
- Bugs caused: #2996 "render GFM tables in Chief chat markdown" (missing feature found in production), `expandCollapsedTableLine` exists because the hand parser could not cope with real model output.
- Risk/benefit: medium. Agent output is exactly where markdown edge cases appear (links render as raw text today, inferred from the missing syntax). Needs visual regression pass; streaming partial markdown must keep working.

### 4. web_fetch: SSRF address classifier, HTML-to-text, entity decoding (checked)
- Where: `apps/daemon/src/backend/web-search.ts` lines 141-222 (`ipv4Private`, `expandIpv6`, `isPrivateAddress`, `decodeEntities`, `htmlToText`) and `assertPublicHost` (:399). Single commit, no fixes yet.
- Re-implements: IPv4/IPv6 range classification (including mapped, NAT64, link-local, ULA), HTML stripping by regex, entity decoding for six entities only (`&nbsp; &lt; &gt; &quot; &#39; &amp;`; `&#x27;`, `&#8217;`, `&mdash;` stay as raw text, checked in code), `<[^>]*>` mishandles `>` inside attribute values.
- Replacement: Node built-in `net.BlockList` (measured present in the running Node 24.14) or `ipaddr.js` 2.5.0 (MIT, 62 KB, 2026-08; `ipaddr.js@1.9.1` already transitive); `htmlparser2` 12.0.0 (MIT, 2026-07) or `html-to-text` 10.0.1 (MIT) with `entities` 9.0.0 (BSD-2) for text, or `@mozilla/readability` for article extraction.
- Wrinkle (inferred, not exercised): the host is resolved in `assertPublicHost` and then `fetch` resolves it again, so DNS rebinding can pass the check and still reach a private address. The library fix is an undici `Agent` with a `connect.lookup` that validates the address actually dialed (undici is already a daemon dependency). Redirects are handled manually with the same check, which is good.
- Risk/benefit: security boundary for agent-initiated fetches; medium-high benefit, low effort for the classifier and entities, medium for the connect-time check.

### 5. YAML mini-parser and SKILL.md frontmatter regex (checked)
- Where: `apps/daemon/src/orb/services-yaml.ts` (337 lines, 1 commit; `parseYamlMapping`, indentation blocks, scalars) and `packages/shared/src/records/skill.ts:53` `parseSkillFrontmatter` (regex, only `name` and `description`, rejects block scalars `>` / `|`).
- Replacement: `yaml` 2.9.1 (ISC, 670 KB unpacked, 2026-09) or `js-yaml` 5.5.0 (MIT, 2026-10); validate with the existing zod schemas. For frontmatter, split on the `---` fence yourself and parse the block with `yaml` (`gray-matter` is unmaintained since 2023, avoid).
- Bugs caused: the frontmatter parser's limits leak into product errors ("name is required (one line, plain value)" at `skills.ts:218`, `skill-import.ts:112`): a valid SKILL.md with a folded description is rejected as invalid. YAML subset gaps (anchors, flow style, multiline strings, quoting rules) are inferred to fail with "yaml trailing content" style errors on valid `.agents/services.yaml`.
- Risk/benefit: low risk, low effort, removes about 340 lines; daemon bundle grows by the `yaml` package (esbuild single-file).

### 6. Shell tokenizer inside the computer-use command guard (checked structure, inferred origin)
- Where: `apps/daemon/src/computer/guard-shell-parse.ts` (276 lines, 1 commit). Structure (CONTROL regex, `parseEnvVar`, chunker, ANSI-C `$'..'` expansion, glob/comment entries) mirrors `shell-quote`'s `parse()`.
- Replacement: `shell-quote` 1.12.0 (MIT, 25 KB, published 2026-10; already in the lockfile, measured). Maintained.
- Risk/benefit: this feeds a security guard (guard*.ts total about 2.7k lines). A vendored copy may be deliberate (fail-closed behavior, `ShellParseEnv` hook, error on bad substitution). If the fork carries real changes, keep it but document the diff against upstream in the file; if not, delete it. No fix commits yet. Action is "decide and document", not necessarily replace.

### 7. Timezone wall-clock arithmetic duplicated four times, plus hard-coded UTC+8 (checked)
- Where: `apps/server/src/lib/snooze-time.ts` (`wallTimeAt`, `offsetAt`, `zonedWallToEpoch`), `apps/web/src/schedules/schedule-model.ts` (`clockParts`, `scheduleTime` iterative fixpoint), `apps/server/src/services/schedules.ts:38` (`wallClockParts`), `apps/server/src/services/chief-report.ts:75-90`; `apps/web/src/board/rel-time.ts` (37 lines).
- Re-implements: converting a zone's wall time to an instant and back via `Intl.DateTimeFormat.formatToParts` offset guessing, DST gap/overlap handling (each copy handles it differently).
- Hard bug (checked): `rel-time.ts:10` `TZ_OFFSET = 8 * HOUR` computes the "yesterday" day boundary in UTC+8 for every user, so "today/yesterday" is wrong anywhere else. Not a filed bug.
- Replacement: Temporal is not available in Node 24.14 (measured `typeof Temporal === 'undefined'`); use `@date-fns/tz` 1.5.0 + `date-fns` 4.4.0 (MIT, published 2026-05; `TZDate`), or `luxon` 3.7.2 (MIT, 4.4 MB unpacked, last publish 2025-09), or `@js-temporal/polyfill` 0.5.1 (ISC, last publish 2025-03, stale). Relative strings: `Intl.RelativeTimeFormat` (built-in) with the day index taken from the viewer's zone.
- Risk/benefit: medium; snooze and schedule firing times are user-visible and DST-sensitive, existing tests give a safety net (#2353 snooze). Collapse into one shared helper first, then swap its internals.

### 8. Secret redaction by hand-written regex list (checked)
- Where: `packages/shared/src/secret-redaction.ts` (59 lines, 3 commits, 2 fixes: #2736 run boundaries, #3348 credentials in logs).
- Covers `token=`, `Authorization: Basic/Bearer`, `gh[pousr]_`, `github_pat_`, `sk-`, and the `v1:` secret-box envelope. Does not cover AWS access keys, Slack `xox*`, Google `AIza`, JWTs, private-key blocks, Stripe `sk_live` shaped differently from `sk-`, npm tokens (checked: none in the pattern).
- Replacement: pattern sets from `secretlint` 13.1.0 recommended preset (MIT, 2026-10) or gitleaks rule regexes as data; keep the cairn-specific envelope rule. This redacts trajectory packs that leave the machine (OTLP push, `traj:export`), and the repo is public.
- Risk/benefit: small file, but leak impact is high; adopt rule data, not a CLI.

### 9. QR code encoder (checked)
- Where: `apps/web/src/lib/qr-code.ts` (403 lines, 1 commit, test `apps/web/test/qr-code.test.ts`). Reed-Solomon, mask scoring, versions 1-10 only, byte mode, ECC level M.
- Used by the remote-access pairing page (`remote-access-page.tsx`, `components/qr-code.tsx`).
- Replacement: `uqr` 0.1.3 (MIT, 77 KB, published 2026-04, zero-dependency, SVG-friendly) or `qrcode-generator` 2.0.4 (MIT, 2025-08) or `qrcode` 1.5.4 (2025-11).
- Limit (inferred): version 10 at level M caps near 213 bytes, so a longer pairing URL fails at runtime with the hand encoder; libraries go to version 40.
- Risk/benefit: low risk, removes 400 lines; ship a golden-matrix test to compare outputs.

### 10. Retry/backoff written six times (checked)
- Where: `apps/daemon/src/machine-loop.ts` (`nextBackoffMs` :109, stream loop :700, claim loop :771), `supervisor.ts:61`, `computer/frame-poster.ts:198`, `apps/server/src/lib/tsnet-sidecar.ts:161` (`restartDelayMs`), `lib/github.ts:1412`, `github-create-gate.ts`.
- Pattern: `min(backoff * 2, cap)`, no jitter in the copies I read (inferred: all machines retry in lockstep after a server restart).
- Replacement: `p-retry` 9.0.0 (MIT, 38 KB, 2026-11) for call-style retries; loops that are really reconnect supervisors can share one `backoff(attempt, {base, cap, jitter})` helper (a library like `cockatiel` is overkill).
- Risk/benefit: low risk, modest benefit. Consolidate to one helper with jitter; library optional.

### 11. Unified diff parsing in three places (checked)
- Where: `apps/server/src/services/git.ts:386-420`, `apps/server/src/trajectory-outcome-backfill.ts:109-140`, `packages/shared/src/records/recording-trigger.ts:82`.
- Re-implements: `diff --git` / `+++` / `@@` scanning. Paths with spaces or quotes (git quotes non-ASCII), renames and binary files are fragile (inferred).
- Replacement: `parsePatch` from `diff` (already a dependency of apps/server and apps/web, measured in package.json). Zero new packages.
- Risk/benefit: low risk, small win; do it.

### 12. Process execution, group kill, ps/lsof parsing, lock files (checked)
- Where: `apps/daemon/src/git.ts` `runGit` (spawn, timeout, process-group kill, Windows `taskkill`), `backend/acp.ts:41`, `workspace-hooks.ts:83`, `computer/process-tree.ts` (parses `ps -Ao`), `orb/services-runtime.ts` (`ps`/`lsof`, pid+start-time lock file), `supervisor.ts`. About 24 spawn/exec call sites.
- Replacement: `execa` 10.2.1 (MIT, 414 KB, 2026-10) covers timeout, `forceKillAfterDelay`, cleanup; it does not kill a whole detached group without help. `tree-kill` (2022) and `proper-lockfile` (2022) are unmaintained, so not recommended.
- Verdict: partial. A single `spawnBounded` helper (the one in `git.ts`) reused by acp/hooks is the real win; the ensure-lock with pid+start time is stronger than the library alternatives. Medium-low priority.

### 13. SSE client parser (checked)
- Where: `apps/daemon/src/machine-client.ts:576-612` (`stream`). Splits on `\n\n`, only `data:` lines, `JSON.parse` per line.
- Misses: `\r\n` framing, multi-line `data:`, comments, `event:`/`id:`/`retry:` fields, `Last-Event-ID` resume; a malformed JSON line throws and tears down the stream (inferred). The server side correctly uses Hono `streamSSE`; the web uses native `EventSource`.
- Replacement: `eventsource-parser` 4.1.3 (MIT, 95 KB, 2026-10; v3.1.1 already transitive) around the fetch body; or `eventsource` 5.1.5 (2026-11, supports custom fetch for the bearer header). 34 commits, 12 fix-ish on the file, but these are mostly protocol changes.
- Risk/benefit: low risk, about 30 lines; worth doing alongside any change to the stream contract.

### 14. OAuth authorization-code flow (checked partially)
- Where: `apps/server/src/services/oauth.ts` (254), `lib/github.ts:2163` `exchangeOAuthCode`, token payload projection, in-memory `states` map with a sweep.
- No PKCE (`code_verifier` and `S256` do not appear anywhere in apps/ or packages/, measured by grep). Authorize URL built by hand, state is a random id in a process-local map (lost on restart; inferred).
- Replacement: `oauth4webapi` (MIT, maintained; not verified with `npm view` here) or `arctic`; for GitHub specifically `@octokit/oauth-methods`. Whether each provider supports PKCE needs a check per provider.
- Risk/benefit: security-sensitive, modest size; medium priority. Inferred beyond the code I read.

### 15. JSON Schema to Zod conversion (checked)
- Where: `apps/daemon/src/backend/claude-code.ts:621-706` (`jsonSchemaToZod`, about 85 lines).
- Replacement: zod 4.6.5, already pinned, ships `z.fromJSONSchema` (`from-json-schema.d.ts` exists in `node_modules/.pnpm/zod@4.6.5`, measured). Keep the fail-closed vocabulary check as a pre-validation on allowed keys (that part is policy), delegate construction.
- Risk/benefit: low; saves about 50 lines. Check the experimental status in zod 4.6 first.

### 16. PNG decode/scale/encode (checked)
- Where: `apps/daemon/src/computer/host-screen-png.ts` (173 lines): chunk parse, inflate with a size cap, unfilter (Paeth), resize, deflate, CRC via `node:zlib`.
- Replacement: `fast-png` 8.0.0 (MIT, 159 KB, 2025-12) for decode/encode plus own scaling, or `sharp` (native, heavy). `pngjs` 7.0.0 is stale (2023).
- Verdict: borderline. Supports only color types 2/6 and has decompression-bomb limits; a pure-JS dependency adds little. Low priority; listed because it is a re-implemented format codec.

### 17. HMAC grant token with hand-rolled base64url (checked)
- Where: `apps/server/src/lib/attachments-token.ts` (103 lines): `b64url`/`b64urlDecode`, HMAC-SHA256 sign/verify, `exp` check, `timingSafeEqual`.
- Node's built-in `Buffer.toString('base64url')` removes the two helper functions; `jose` 6.2.16 (MIT, published 2026-11-08, 216 KB) would replace the whole token with an HS256 JWT if interop or standard claims are wanted.
- Risk/benefit: small. The crypto (HMAC + timing-safe compare + derived key) is correct; recommend only the `base64url` simplification. Do not rewrite a security boundary for style.

### 18. Record id and UUIDv7 generation (checked)
- Where: `apps/server/src/lib/ids.ts` (30 lines): `newRecordId` is a nanoid-style generator (first character uses `byte % 62`, a small modulo bias; others use `& 63` on a 64-char alphabet, fine), `newUuidv7` sets version bits by hand with no monotonic counter, so two ids in the same millisecond are unordered (inferred impact on ordering).
- Replacement: `nanoid` 6.0.2 (MIT, 14 KB, 2026-10), `uuid` 14.0.3 (MIT, 64 KB; v7 with monotonic sequencing) or `uuidv7` 1.2.1 (Apache-2.0).
- Risk/benefit: tiny; id format must stay compatible with existing rows and the `SKILL_DIR_NAME_RE`/path-id regexes. Low priority.

### 19. Orb stdio RPC and relay (inferred)
- Where: `apps/daemon/src/orb/relay.ts` (574), `protocol.ts` (155), `e2b-stream.ts` (90): numbered requests, pending map, abort, frame cap, `cairn-orb-rpc:` line prefix.
- Candidate libraries: `json-rpc-2.0` or `vscode-jsonrpc`. Most of the code is the method allowlist, size caps and error mapping, not framing, so the saving is small and the protocol is a deliberate trust boundary between host and container. Borderline; no action recommended beyond a design note on why JSON-RPC was not used.

## Justified hand-rolled code

1. `apps/server/src/services/merge-gate/paths.ts` `globToRegExp` (about 20 lines): protected-path gate. `picomatch` 4.0.7 or `minimatch` 11.0.5 would work, but semantics (case-insensitive, `/**` tail, unicode, fail-closed on unsafe characters) decide what an agent may auto-merge, and a test pins it to `merge-gate-paths.json`. Switching trades a known contract for a different one.
2. `apps/daemon/src/git.ts` and `apps/server/src/lib/git.ts` (system-git wrapper): `simple-git` and `isomorphic-git` are explicitly prohibited by the seam (no worktree/http-backend support). Only the generic spawn helper in finding 12 is shared-library-shaped.
3. `packages/shared/src/ansi.ts` (7 lines): `strip-ansi` 7.2.0 is 4 KB, but a one-regex file is cheaper than a dependency. Acceptable.
4. `packages/shared/src/token-estimate.ts` (8 lines): coarse budget heuristic; `tiktoken`-class tokenizers are heavy and model-specific. Acceptable.
5. `apps/web/src/i18n/translate.ts` (30 lines): template plus `Intl.PluralRules`; i18next/lingui would be heavier than the whole mechanism.
6. `apps/server/src/lib/secret-box.ts`: AES-256-GCM through `node:crypto` with versioned envelope and a 0600 keyfile. This is the platform primitive; no better library.
7. `apps/server/src/lib/token-auth.ts` (`makeVerifier`: hash both sides then `timingSafeEqual`) and `lib/hash.ts`, `lib/crypto.ts`, `lib/keys.ts`: thin wrappers over `node:crypto`.
8. Server CLIs (`trajectory-*-cli.ts`, `eval-*-cli.ts`) use built-in `node:util.parseArgs`; the daemon CLI uses `commander`. No hand-parsed argv except two trivial positional scripts (`orb-probe.ts`, `trajectory-attribution-summary-cli.ts`).
9. Cron: `cron-parser` via the Scheduler seam in `services/schedules.ts`; scheduler tick loop (`services/scheduler.ts`) is application logic.
10. SSE on the server (`hono/streaming` `streamSSE`) and in the web (native `EventSource` with a thin reconnect wrapper in `api/sse-connection.ts`), syntax highlighting (`shiki/core` in `detail/code-highlight.ts`), word/line diff (`diff` in `word-diff.ts`), drag and drop (`@dnd-kit`), data fetching (`@tanstack/react-query`), push (`web-push`), WebSocket (`ws`, `undici`), JSON validation (`zod`): libraries are used where expected.
11. Visual one-offs: `lib/spiral-avatar.ts`, `lib/brand-mark.ts`, `lib/focus-ring.ts`: product-specific, no library equivalent.

## Other observations
- `@opentelemetry/*` is restricted in `biome.json` to `apps/daemon/src/backend/otel.ts`, but no OTel package is installed, so the rule and the bridge name exist without the library; the server side (`runtime-otel.ts`) is outside the stated bridge.
- Attachments: the server trusts the client-provided MIME type (`routes-uploads.ts` passes `file.type`, allowlist by prefix in `attachments.ts:32`); responses add `x-content-type-options: nosniff`, so the risk is content-type spoofing for display, not execution (inferred, not tested). `file-type` (magic-byte sniffing) is the library if that matters.
- Not checked in depth: `services/chief*.ts`, `memory.ts`, `pr-wakes.ts` internals, iOS client (`apps/ios`, Swift), `apps/tsnet-sidecar` (Go), `site/`, `integration/`.
