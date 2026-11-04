## Upstream

Control fixture for the HTML-embedding fix in #1335. The fix lets
`<img src="...">` and `<source srcset="...">` count as embedded, so
the Cursor badge footer the agent injects after
`<!-- CURSOR_AGENT_PR_BODY_END -->` no longer trips the gate. A bare
external image URL that is not wrapped in any of the three forms
(markdown `![label](url)`, HTML `<img src>`, HTML `<source srcset>`)
must still RED -- the fix is not a free pass for forgotten image
links.

## Verified

Control fixture; no red/green output pair. The answer exists so the
section check stays satisfied while the link check exercises the
negative case the fix must NOT relax.

## Evidence

Plain bare URL, no markdown wrapper, no HTML embedding:

https://example.com/evidence-shot.png