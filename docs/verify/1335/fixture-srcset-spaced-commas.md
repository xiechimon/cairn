## Upstream

srcset-spacing fixture (#1335): a `<source srcset>` whose URLs are
separated by a comma and a space must register both URLs as embedded,
not only the first. The Cursor badge footer does not exercise this
shape today, but the docstring claims "any comma-separated URL in a
`<source srcset>`" -- the claim only holds when whitespace after each
comma is allowed. Link-criteria fixture; no mechanism is added.

## Verified

srcset-spacing fixture; no red/green output pair is pasted. The
answer exists to isolate the link verdicts from the section check.

## Evidence

<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/spaced-dark.svg, https://img.shields.io/badge/spaced-light.svg"><img alt="badge" src="https://img.shields.io/badge/spaced-fallback.svg"></picture>
