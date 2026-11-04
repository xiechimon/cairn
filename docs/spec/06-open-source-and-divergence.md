# 06 · Open-source and divergence decision (settled by the 2026-09-25 grilling)

> **superseded-in-part (2026-10-08, #1013 / #991 Q13 remaining-volume reconciliation)**: the remaining-volume supersede reconciliation left over from the #908 move is booked here. The voided surface = §1 (D1 section)'s "the parity harness is kept, its identity changing from 'parity gate' to 'regression tool'" — the pixel side-by-side tooling `parity/` and all its baselines have been removed (`e52d09e8`, 2026-09-28); the visual-regression vehicle from then on is the e2e visual specs + probe:dump (canon = spec/19 test layering). Reconciled in the same entry: volume 18's revision of the D1 positioning narrative sentence is a **revision, not a supersede** (it does not constitute a superseded surface; the existing header-note wording is unchanged — "an autonomous product / starting as a replacement / diverging from real usage" still holds). The remaining decisions (D2–D9 and this volume's open-source / divergence direction) are unaffected by the UI-form chain (ADR 0009 → ADR 0010 → ADR 0012) and remain canon. The original text is kept wholesale as the historical ledger, not deleted.

> Canonical status: this volume = the direction decision for pacman's shift from "a todos.dev 1:1 replication project" to "an autonomous open-source product",
> taking priority over volume 03's replication build order (volume 03's M0–M6 has closed its loop and serves as the historical archive only).
> Ruling source: settled by the 2026-09-25 grilling in three rounds of nine questions.
> The D1 positioning narrative was revised by [volume 18](18-positioning-and-differentiation.md) (2026-10-02) — a revision, not a supersede; the rest of this volume's decisions remain in effect.

## 0. Summary of decisions

| # | Item | Settled |
|---|---|---|
| D1 | Positioning | An autonomous product. Narrative = self-hosted, open-source agent workspace; starting as a replacement, diverging from real usage → revised by volume 18 (the revision does not supersede: the narrative sentence has been swapped for the scarce-claim one; "an autonomous product / starting as a replacement / diverging from real usage" still holds) |
| D2 | License | Apache-2.0 |
| D3 | Name | Keep pacman; the npm release = the `@xiechimon/pacman` scope; a rename window is kept |
| D4 | Public strategy | The repo stays public; no proactive promotion before the storefront (W1) is fixed |
| D5 | Working mode | The repo owner = the product owner (sets direction, reviews PRs); construction goes through agent lanes |
| D6 | Documentation language | The README is written primarily in English + a Chinese secondary page; the spec/research volumes stay Chinese as the internal canon |
| D7 | Research assets | The `docs/research/` screenshots and the entire git history stay as they are; the storefront carries no disclaimer, and a one-sentence Origins section at the page footer records the clean-room provenance (revised 2026-09-25); the asset audit constrains only in-product assets |
| D8 | Authentication | Optional token authentication (enabled explicitly via env, off by default) + a WARN on a bare `0.0.0.0` bind at startup |
| D9 | Cadence | W1 storefront+auth → W2 npm first release → W3 steer interruption → W4+ follow-up tickets by emergence |

## 1. D1 positioning and impact on existing volumes

- The replication side-by-side obligation is lifted from this volume onward: the vocabulary side-by-side of volumes 02/04 and the pixel thresholds no longer constrain new features;
  the parity harness is kept, its identity changing from "parity gate" to "regression tool".
- The `CONTEXT.md` glossary remains in effect (the single source of in-product terminology); rulings on new-concept naming are appended via later ADRs of this volume.
- Volume 05 §6's follow-up-ticket list becomes its own backlog, ordered by usage pain emerging (W4+).

## 2. D2 License

Apache-2.0: MIT's permissiveness + a patent-grant clause, the mainstream choice for the dev-tools niche.
Landing = W1: the full `LICENSE` at the root + the `package.json` license fields aligned.

## 3. D3 Name

Keep pacman. `pacman` on npm is taken (by a static-site generator), so the release form =
the `@xiechimon/pacman` scoped package, and `npx @xiechimon/pacman` is still one command.
If a rename ever happens: the brand-slot single source (02 §5.8) replaces it repo-wide in one shot, and a GitHub rename has automatic redirects.

## 4. D4 Public strategy

The repo has been public from the start and does not go private; no proactive promotion on any channel before the storefront is fixed.
The definition of "storefront fixed" = all W1 tickets landed.

## 5. D5 Working mode

The repo owner sets direction and reviews PRs; construction goes through agent lanes (the worktree + PR discipline unchanged,
`AGENTS.md` continues to constrain all lanes and commits).

## 6. D6 Documentation language

`README.md` is written primarily in English (the open-source audience's default surface) + a linked Chinese secondary page `README.zh.md`;
`docs/spec/` and `docs/research/` stay Chinese, untranslated.

## 7. D7 Research assets

The original-site screenshots in `docs/research/` and the entire git history stay as they are — no scrubbing, no moving out.
The storefront wording (revised 2026-09-25): the README carries no "disclaimer" block — the self-restraint wording from the replication-research period
conflicts with the D1 product positioning, and a prominent statement would advertise the replication relationship in reverse; the substitute form = a one-sentence
Origins section at the page footer (neutrally recording the clean-room origin, neither apologizing nor stressing "no affiliation"). The legal substance =
a clean implementation + zero original-site assets (the asset audit) + not using the other party's trademarks, and it does not depend on the declaration text.
The asset audit constrains only in-product assets (AppIcon / favicon / brand strings / external references),
checked item by item per `docs/spec/asset-replacement-plan.md` (#44).

## 8. D8 Authentication

- **Optional token authentication**: enabled explicitly via env, off by default; the shape details (the protected-surface boundary, the machine-endpoint exemption list, the enumeration of bypass paths) are pinned by the W1 spec, and the implementation lists the bypass paths before writing code.
- **Startup guardrail**: when the server detects a `0.0.0.0` bind with authentication not enabled → a prominent WARN in the startup log.
- A full account system is not built (it conflicts with the lightweight self-hosted positioning).

## 9. D9 Waves

| Wave | Content |
|---|---|
| W1 storefront + auth | LICENSE; the README rewritten in English + a Chinese secondary page; the repo description/topics fixed; issue/PR templates; the asset audit (AppIcon/favicon/brand strings); optional token authentication + the `0.0.0.0` WARN |
| W2 npm first release | the web dist pre-bundled into the package; the `@xiechimon/pacman` publish pipeline; version 0.1.0; the `npx` one-command live test |
| W3 steer interruption | sending messages in the building/review states — the daemon seam is in place and the vocabulary has a slot; add the REST + web surfaces (a real functional gap confirmed during the replication period) |
| W4+ | volume 05 §6's remaining follow-up tickets (OAuth family extensions, the authorization page, server-side search, streamdown, the API-key permission-bit popover, etc.) ordered by usage pain emerging |

## 10. Premortem guardrails

1. **Rights claims from the original site** (low but non-zero probability) → the W1 asset audit guarantees zero original-site assets in the product; the Origins section truthfully records the origin (the post-D7-revision form); W3 builds differentiation evidence as early as possible.
2. **No one shows up after release, maintenance stalls** (the most common open-source death) → self-use makes us the first user; make the storefront look "alive"; post to selected communities after release, no carpet-bombing.
3. **A half-baked optional token expands the security surface instead** → the W1 spec pins the shape (off by default, the exemption list, the bypass-path enumeration first), and /tdd lists the failure modes before writing code.

## 11. W2 release-form decisions (settled by the 2026-09-25 grilling)

| # | Item | Settled |
|---|---|---|
| W2-D1 | Package split | Two packages: `@xiechimon/pacman` (server + embedded web dist) + `@xiechimon/pacman-cli` (the executor daemon, the current `@pacman/cli` renamed into the scope) |
| W2-D2 | The server artifact | esbuild single ESM bundle (following the daemon `build.mjs` precedent); all JS dependencies bundled, native ones (better-sqlite3) external |
| W2-D3 | The SQLite driver | Keep better-sqlite3 (prebuilt coverage for Node 22/24 LTS, the README declares the LTS recommendation); the node:sqlite migration hangs on the watch list — drizzle 0.45.3 (latest) has no official driver, and a self-written sqlite-proxy adapter is a separate-ticket magnitude; wait for official support or a proven pain point |
| W2-D4 | Versioning / discipline | First release 0.1.0; engines stay `>=22.19`; manual publish + a wizard taking the human-in-place path (npm login/2FA/token); changesets not pre-installed (revisit when a pain point fires) |
| W2-D5 | Acceptance criterion | `npx @xiechimon/pacman` starts the server in one command (embedded web, first-start auto create-database + migrate + seed); `npm i -g @xiechimon/pacman-cli && pacman start --api-key …`; the full chain measured in a clean environment |

Factual baseline (pre-grill reconnaissance, measured): shared = bare TS exports (bundled at build time, not published separately); the daemon already has a bin + a `build.mjs` bundle precedent; pnpm 12's publish automatically replaces `catalog:`/`workspace:`; the latest drizzle still has no node:sqlite driver.

bin disposition: the main package's bin = `pacman` (the npx main path); the cli package's bin stays `pacman` (the existing docs and the "add machine" popover command copy unchanged). A same-machine global double-install has the later install overwriting the earlier — an edge scenario, declared in the README with a recommendation to deploy on separate machines.

## 12. W2 first-release runbook (wizard)

Execution surface: `bash scripts/publish-npm-first-release.sh` (delivered by #263; the vehicle for #266's first real-human run). Six phases; the wizard only guides, collects values, and does read-only verification (`npm whoami` / `npm view` / `curl`), and never publishes automatically:

1. **npm-account confirmation** — `npm whoami` read-only verification; if not logged in, guide to `npm login` in another terminal, retry five times then circuit-break.
2. **2FA status** — `npmjs.com/settings/<user>/tfa`. The publish threshold = account 2FA or a bypass token (npm's current rules); this flow takes the former; a recovery-code login triggers a 72h publish/token-creation freeze, which the wizard states explicitly.
3. **granular token (env only, never on disk)** — collected via `read -rs` (fish: `read -s`) into the shell env, passed as the `npm publish --//registry.npmjs.org/:_authToken="$NPM_PUBLISH_TOKEN"` argument form; never written to `.env` / `.npmrc` / shell history. The trade-off basis (docs.npmjs.com, verified 2026-09-25, measured): only granular tokens exist since 2025-11; `NODE_AUTH_TOKEN` is not npm-native (it works only through the .npmrc interpolation written by setup-node, which this wizard does not write, so it is not used); the scope prefers `@xiechimon`, but an empty scope cannot be selected in the picker before the first release, so the fallback = All Packages + 7-day expiry + delete immediately after; no bypass checked — bypass publishing will be removed by npm in 2027-01, and account 2FA + an interactive publish OTP already satisfies the publish threshold.
4. **Two-package publish order (human-in-place)** — `@xiechimon/pacman` first, `@xiechimon/pacman-cli` second (no interdependency; the order keeps the acceptance chain testable early); the commands are printed for a human to run line by line in their own terminal. Failed pre-checks/collection circuit-break immediately: the package names unshaped (#261/#262 not landed), `private: true`, dependencies carrying `workspace:`/`catalog:` (npm publish would stamp them into the manifest verbatim), a non-0.1.0 version already on the registry, or token collection failed (the publish command is not shown; re-run after finishing Stage 3's collection — no tokenless publish path is provided). Packages already showing 0.1.0 on the registry are skipped (resumable). After publishing, the wizard verifies both 0.1.0 via `npm view`.
5. **Clean-environment npx acceptance (W2-D5 criterion)** — `mktemp -d` isolated HOME + the 8791 port segment auto-avoiding (the main repo's dev stack on 5173/8787 and other lanes' 8390/8399 untouched); a human runs `env PORT=… HOME=… npx -y @xiechimon/pacman`, and the wizard polls `/app` 200, `/api/user/me` 200, and `.pacman/server/server.db` landing under the isolated HOME; then create an API key in the web → `npm i -g @xiechimon/pacman-cli` → `pacman start --api-key … --server …` enroll → verify the machine list by eye. localhost probes carry `--noproxy '*'` (under a proxied shell, curl would send 127.0.0.1 to the proxy and get a 503).
6. **Post-actions** — delete the first-release token; daily subsequent releases go through `npm login` + OTP and do not depend on a long-lived token.

Resume semantics: Ctrl-C at any phase and re-run from the top (the wizard leaves nothing on disk, and the token is collected fresh each time); the script hard-codes the 0.1.0 first-release criterion (version check, token name, breakpoint judgment); later first-releases of subsequent versions reuse it by changing the version number the same way; daily minor versions are just bump + `npm publish` + OTP.
