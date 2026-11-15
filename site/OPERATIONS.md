# Website search and analytics setup

## Deployment

The public site is `https://cairn.xmon.me`. Astro and Starlight build `site/dist`; `.github/workflows/site-deploy.yml` uploads that output to Vercel after changes under `site/` land on `main`, provided the repository variable `VERCEL_DEPLOY` is `on`. Vercel Git deployments are disabled in `site/vercel.json`. Do not trigger a production deployment just to verify account ownership.

## Google Search Console

DNS verification needs no site code or deployment, and covers both languages and every protocol under this hostname.

1. Open [Search Console](https://search.google.com/search-console/), sign in with the Google account that should own the property, and choose **Add property**.
2. Choose **Domain**, enter `cairn.xmon.me` without a scheme or path, and copy the complete TXT value Google generates, beginning `google-site-verification=`. This is an account-specific value; no placeholder in this repository will verify ownership.
3. Open the provider that actually hosts the domain's DNS records, not necessarily the registrar or Vercel. In the `xmon.me` zone, add a new **TXT** record with name `cairn` and the copied value. Providers that require a fully qualified name need `cairn.xmon.me` instead. If `cairn.xmon.me` is its own delegated zone, use that zone's root (`@`). Keep existing records, including other TXT records. If a CNAME at this exact name prevents adding TXT, do not replace it: verify the parent Domain property `xmon.me` with TXT at its root instead; it includes Cairn.
4. Save, return to Google, and choose **Verify**. If DNS has not propagated, wait and retry; do not change the value or remove the record after success.
5. Under **Sitemaps**, submit `https://cairn.xmon.me/sitemap-index.xml`. Use **URL inspection** on the homepage and an installation page to check whether Google can fetch and index them. Submission does not guarantee indexing.

Official instructions: [Google ownership verification](https://support.google.com/webmasters/answer/9008080).

## Bing Webmaster Tools

1. Open [Bing Webmaster Tools](https://www.bing.com/webmasters/), sign in, and choose **Import** from Google Search Console.
2. Read the requested Google permissions, authorize only if acceptable, select the verified Cairn property, and import it. Bing's import can request ongoing Search Console access. If only the parent `xmon.me` property is listed, import it and filter reports to Cairn, or add `https://cairn.xmon.me/` manually.
3. Check **Sitemaps** for `https://cairn.xmon.me/sitemap-index.xml`; add it if missing. Use **URL inspection** to test a real page.
4. If Google import is unwanted or unavailable, choose manual site addition and Bing's **CNAME** verification. Add exactly the unique DNS name and target Bing supplies, at the authoritative DNS provider, then choose **Verify**. Do not alter the existing website CNAME.

Official instructions: [Bing site addition and verification](https://www4.bing.com/webmasters/help/add-and-verify-site-12184f8b).

## Cookieless analytics: account approval still required

No analytics service or tracking script is enabled by this change. The site deploys to Vercel, so [Vercel Web Analytics](https://vercel.com/docs/analytics) is the closest native option and does not use cookies. However, an owner must sign in to the Vercel team, check its current plan and [pricing](https://vercel.com/docs/analytics/limits-and-pricing), then explicitly enable it on the site project. Hobby currently includes 50,000 events per month; Pro is usage-billed. Do not upgrade or turn on a billable service for this request.

After the owner confirms a free eligible plan and approves activation, follow the [Astro integration quickstart](https://vercel.com/docs/analytics/quickstart): enable **Analytics** in the correct project, add the official integration to both the custom homepage and Starlight documentation, and deploy through the normal PR workflow. The dashboard toggle alone does not instrument pages. Check the production Network panel and dashboard for an actual visit, with browser privacy blocking accounted for. Do not send personal information, credentials or private URLs in events.

If Vercel would cost money, [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/get-started/) is a free, cookieless alternative that can run on a Vercel-hosted site. It still needs an owner login and a site-specific beacon token, so it also awaits approval and setup. Do not add a fake token or migrate hosting merely for analytics.

Basic traffic is not a conversion funnel: Vercel Hobby does not include custom events or UTM reporting. Referrers can identify some AI visits, but cannot count answers that cite Cairn without a click. Do not call visits, GitHub clicks or install-command copies completed installations. Cairn is self-hosted; actual activation is not observable from this public site without a separately approved measurement design.

## After deployment and each week

Once after deployment, check that `/robots.txt` and `/llms.txt` return plain text with HTTP 200, the robots file advertises the sitemap, and the sitemap's page links resolve. Check that a Chinese browser visiting the English homepage retains its query parameters and fragment after redirection. `llms.txt` is a convenience index, not a promise that AI search engines will read or cite the site.

Each week, compare Search Console clicks, impressions, queries, landing pages and indexing exclusions; Bing search performance and any available AI citation report; and analytics referrers and landing pages once analytics is connected. Use several weeks of data on a low-traffic site, not a single quiet week, to decide which content needs work. Check installation documentation whenever the product changes; those updates should not wait for a weekly SEO batch. Do not delete an unindexed page automatically or generate thousands of keyword variants.
