## Upstream

query-string/fragment fixture (PR #1335): `<img src>` and
`<source srcset>` URLs in the Cursor badge footer or any
GitHub-rendered picture may carry a `?query` or `#fragment` after
the file extension. IMG_URL's regex terminates at the matched
`.svg`/`.png` so its span ends at the extension, while the embed
span covers through the trailing query/fragment. The two spans
disagree on stop-offset and the equality test in find_links
mistakenly falls the URL through to bare, even though GitHub
renders the image. Containment (the IMG_URL span inside the embed
span) keeps the form recognised while preserving comment-stripping
and reachability. Link-criteria fixture; no new mechanism.

## Verified

query-string fixture; no red/green pair pasted. The answer exists
to isolate the link verdicts from the section check.

## Evidence

<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/query-dark.svg?v=1#anchor, https://img.shields.io/badge/query-light.svg?light"><img alt="badge" src="https://img.shields.io/badge/query-fallback.svg#frag"></picture>
