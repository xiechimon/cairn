## Upstream

srcset-descriptor fixture (#1335): each URL inside a
`<source srcset="...">` may carry a width or pixel-density descriptor
(`2x`, `100w`). Only the URL portion is the link target -- the
descriptor is metadata, not part of the URL. The HTML_EMBED span
must be registered at the URL's offset so IMG_URL's narrower span
matches. Without this, both URLs in a srcset fall through to bare.
Link-criteria fixture; no mechanism is added.

## Verified

srcset-descriptor fixture; no red/green output pair is pasted. The
answer exists to isolate the link verdicts from the section check.

## Evidence

<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/dark.svg 2x, https://img.shields.io/badge/light.svg 1x"><img alt="badge" src="https://img.shields.io/badge/fallback.svg"></picture>
