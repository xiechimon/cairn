# GEO Weekly Measurement & Maintenance Loop

> **Status (`Phase 1` vs `Phase 2`):** Phase 1 delivers the static guides, quality gate, and standalone CLI scripts in `scripts/geo/` (`docs/design/geo-loop.md`; research record: `docs/research/geo-2026-11-27.md`). **Phase 2 automated weekly runs** are not active yet and begin only after the owner completes the login, Search Console DNS, Bing import, and optional Cloudflare token checklist. **Failure ownership:** the owner resolves login walls, CAPTCHAs, DNS records, and token configuration; the maintainer reviews audit/rewrite PRs and updates `site/geo/maintenance-state.json`.

## Constraints

1. **One real question per page:** Never publish bulk keyword variants or machine-translated mirror pages. Every guide must pass `node scripts/geo/quality-gate.mjs` before build or push.
2. **Mac desktop app first:** Every page leads with the Mac desktop app (`Cairn-<version>-mac-arm64.dmg` / `x64.dmg`) and positions `npx @xiechimon/cairn` + Docker as the advanced self-hosted path.
3. **Free consumer browser citation panel only:** Never use paid citation APIs and never query Anthropic/Claude. Check citations in the owner's logged-in Chrome via approved channels (`browsermcp` or Cairn's user-computer tools) across the 8 free engines in `site/geo/panel-questions.json`: ChatGPT, Perplexity, Google AI Overviews, DeepSeek, Kimi, Doubao (`` `豆包` ``), Qwen (`` `通义千问` ``), and Tencent Yuanbao (`` `腾讯元宝` ``).
4. **Never auto-delete unindexed pages:** A page in `crawled_not_indexed` after 6+ weeks gets rewritten or merged into its strongest same-locale cluster peer, keeping a permanent 301 redirect in `site/vercel.json`, updating internal guide links (enforced by `quality-gate.mjs`), and marking `status: "merged_301"` in `site/geo/questions.jsonl` so subsequent runs emit `ALREADY_MERGED_301` without creating redirect loops.

## Weekly Steps (Cairn Schedule)

Run once per week (for example Monday 09:00 local time) as a Cairn recurring schedule:

1. **Snapshot free metrics:**
   ```sh
   node scripts/geo/snapshot-metrics.mjs --out /tmp/geo-snapshot.jsonl
   ```
   Pass `--gsc-json <path>` and `--bing-json <path>` when exported from Google Search Console and Bing Webmaster Tools, and optionally `CF_ANALYTICS_TOKEN` + `CF_SITE_TAG` for Cloudflare Web Analytics GraphQL reads.
2. **Run free browser citation panel (approved channel only):**
   Test the prompts in `site/geo/panel-questions.json` in the owner's logged-in browser via `browsermcp` or Cairn's own browser tools (only on engines with an active session; stop and list `needs_login` for any engine showing a login wall or CAPTCHA), then summarize with:
   ```sh
   node scripts/geo/citation-panel.mjs
   ```
3. **Evaluate indexing & maintenance actions:**
   ```sh
   node scripts/geo/evaluate-maintenance.mjs --gsc-json /tmp/gsc-pages.json
   ```
   Pass `--gsc-json` as `{ "exportedAt": "YYYY-MM-DD", "pages": [...] }`. By default, `evaluate-maintenance.mjs` atomically persists `site/geo/maintenance-state.json` (pass `--dry-run` to preview without writing) so unconsumed weekly runs still enforce freezes in `quality-gate.mjs`:
   - `GROW` (`>=80%` indexed and `>=50%` aged GSC coverage): mine new distinct questions from GitHub issues, HN, Reddit, and V2EX into `site/geo/questions.jsonl`, draft new guides, and verify with `node scripts/geo/quality-gate.mjs`.
   - `HOLD` / `INCOMPLETE_GSC_DATA` / `STALE_GSC_DATA`: pause expansion and run `REWRITE` / `INTERNAL_LINKS_AND_INDEXNOW` / `REFRESH_VERIFICATION` actions.
   - `FREEZE_AND_AUDIT` (`<50%` new-page or overall indexing, or `--manual-action`): stop all new page generation and audit thin or overlapping pages.
   - `MERGE_WITH_301` (`crawled_not_indexed` >= 42 days): merge content into the recommended same-locale cluster peer, add a permanent 301 redirect in `site/vercel.json`, mark `status: "merged_301"` in `site/geo/questions.jsonl`, and update inbound links.
4. **Land and ping IndexNow (only after deploy is live):**
   Verify changes through `node scripts/ops/preflight.mjs --wait` and `node scripts/ops/push-queue.mjs --wait`. After `site-deploy.yml` finishes on `main`, submit updated sitemap URLs (checks live `200` on the key file and sample guide before POSTing, and deduplicates repeat submissions within 24h):
   ```sh
   node scripts/geo/indexnow-submit.mjs --submit --sitemap /tmp/live-sitemap-0.xml --cache-file /tmp/geo-indexnow-cache.json
   ```

## Example Cairn Weekly Schedule Prompt

Create a recurring weekly task in Cairn targeting this repository with cron `0 9 * * 1`:

```text
Follow docs/ops/geo-weekly-loop.md:
1. Run node scripts/geo/snapshot-metrics.mjs and summarize stars, 14-day views, referrers, and net .dmg downloads.
2. Check site/geo/panel-questions.json against the 8 free consumer engines through the approved browser channel without bypassing logins or CAPTCHAs, and run node scripts/geo/citation-panel.mjs.
3. Run node scripts/geo/evaluate-maintenance.mjs. If growthDecision is FREEZE_AND_AUDIT, stop new page generation and open an audit report; if GROW, draft only high-signal new questions with real source_urls, verify with node scripts/geo/quality-gate.mjs, and submit via preflight + push-queue.
```
