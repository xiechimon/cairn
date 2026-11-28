# Website search and analytics setup

## Deployment

The public site is `https://cairn.xmon.me`. Astro and Starlight build `site/dist`; `.github/workflows/site-deploy.yml` uploads that output to Vercel after changes under `site/` land on `main`, provided the repository variable `VERCEL_DEPLOY` is `on`. Vercel Git deployments are disabled in `site/vercel.json`. Do not trigger a production deployment just to verify account ownership.

## Google Search Console

DNS verification needs no site code or deployment, and covers both languages and every protocol under this hostname. The `xmon.me` DNS zone is in the connected Cloudflare account; Amp can add the record after the owner supplies Google's verification value.

1. Open [Search Console](https://search.google.com/search-console/), sign in with the Google account that should own the property, and choose **Add property**.
2. Choose **Domain**, enter `cairn.xmon.me` without a scheme or path, and copy the complete TXT value Google generates, beginning `google-site-verification=`. This is an account-specific value; no placeholder in this repository will verify ownership.
3. Send that complete TXT value to Amp. Do not send account passwords or sign-in codes. Amp adds a TXT record named `cairn` in the Cloudflare `xmon.me` zone, preserving existing records. If an existing CNAME prevents this, Amp reports the conflict instead of replacing the website record.
4. Once Amp confirms the DNS record is ready, return to Google and choose **Verify**. If DNS has not propagated, wait and retry; keep the record after success.
5. After verification, submit `https://cairn.xmon.me/sitemap-index.xml` under **Sitemaps** and inspect the homepage and an installation page. Submission does not guarantee indexing.

Official instructions: [Google ownership verification](https://support.google.com/webmasters/answer/9008080).

## Bing Webmaster Tools

1. Open [Bing Webmaster Tools](https://www.bing.com/webmasters/), sign in, and choose **Import** from Google Search Console.
2. Read the requested Google permissions, authorize only if acceptable, select the verified Cairn property, and import it. Bing's import can request ongoing Search Console access.
3. Check **Sitemaps** for `https://cairn.xmon.me/sitemap-index.xml`; add it if missing. Use **URL inspection** to test a real page.

Official instructions: [Bing site addition and verification](https://www4.bing.com/webmasters/help/add-and-verify-site-12184f8b).

## Cloudflare Web Analytics

The owner selected the free, cookieless [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/) service and created `cairn.xmon.me` in the connected Cloudflare account with automatic injection disabled. Hosting stays on Vercel; Vercel Analytics is not used. No further analytics account decision is pending.

The official deferred beacon comes from one shared component (`src/components/CloudflareBeacon.astro`) rendered by every custom page, plus Starlight's `head` configuration (`astro.config.mjs`), covering English, Chinese, documentation and the error page. The beacon's site token is a public identifier, not a Cloudflare API credential. Keep automatic injection disabled to avoid loading it twice. Installation follows Cloudflare's [manual setup instructions](https://developers.cloudflare.com/web-analytics/get-started/); the installed Starlight head schema supports script tags and boolean `defer` attributes. No SDK or hosting migration is required.

There is no Content Security Policy in the checked-in site configuration. If one is introduced or added at the hosting layer, allow `https://static.cloudflareinsights.com` in `script-src` and `https://cloudflareinsights.com` in `connect-src`, following the [Cloudflare CSP guidance](https://developers.cloudflare.com/web-analytics/faq/). Do not add a permissive policy merely to enable statistics. After deployment, check the rendered HTML for exactly one beacon on each content page and check the dashboard for incoming visits. Browser privacy settings can block collection. Local tests intercept the beacon request so they do not send fabricated visits to the real account.

Basic traffic is not a conversion funnel. Cloudflare does not log query strings or UTM parameters; use referrers and landing paths. Referrers can identify some AI visits, but cannot count answers that cite Cairn without a click. Do not call visits, GitHub clicks or install-command copies completed installations. Cairn is a Mac desktop app with an optional self-hosted server path; actual activation is not observable from this public site without a separately approved measurement design. Do not send personal information, credentials or private URLs in events.

## After deployment and each week

Once after deployment, check that `/robots.txt` and `/llms.txt` return plain text with HTTP 200, the robots file advertises the sitemap, and the sitemap's page links resolve. Check that a Chinese browser visiting the English homepage retains its query parameters and fragment after redirection. `llms.txt` is a convenience index, not a promise that AI search engines will read or cite the site.

Each week, follow `docs/ops/geo-weekly-loop.md`: compare Search Console clicks, impressions, queries, landing pages and indexing exclusions; Bing search performance and AI Performance citations; Cloudflare analytics referrers and landing pages; GitHub net `.dmg` downloads; and the free logged-in consumer browser citation panel (no paid APIs, no Anthropic). Use several weeks of data on a low-traffic site, not a single quiet week, to decide which content needs work. Check installation documentation whenever the product changes; those updates should not wait for a weekly SEO batch. Each page answers one real question with a real answer; no bulk keyword variants. Do not delete an unindexed page automatically.
