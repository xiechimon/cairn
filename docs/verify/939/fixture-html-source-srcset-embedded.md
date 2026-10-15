## Upstream

HTML embedding fixture (#1335): each URL inside a
`<source srcset="...">` attribute must count as embedded. The badge
footer the agent injects is shaped this way -- one `<picture>` with two
`<source>` variants and an `<img>` fallback. Link-criteria fixture; no
mechanism is added.

## Verified

HTML embedding fixture; no output pair is pasted. The answer exists
to isolate the link verdicts from the section check.

## Evidence

<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/ci-passing-dark.svg"><source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/ci-passing-light.svg"><img alt="badge" src="https://img.shields.io/badge/ci-passing-brightgreen.svg"></picture>