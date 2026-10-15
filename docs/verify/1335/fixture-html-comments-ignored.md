## Upstream

html-comments fixture (#1335): URLs inside `<!-- ... -->` are not
rendered by GitHub, so the gate must not treat them as embedded --
otherwise a "commented-out image link" green-flags a URL the body
never shows. The same URL outside a comment is still green when it
is wrapped in a real form (markdown image, HTML img, HTML source)
and still red when it is bare, so the fix is local to comment text.
Link-criteria fixture; no mechanism is added.

## Verified

html-comments fixture; no red/green output pair is pasted. The
answer exists to isolate the link verdicts from the section check.

## Evidence

The image link below is inside an HTML comment and must not be
scanned:

<!-- <img src="https://img.shields.io/badge/comment-ignored.svg"> -->

A second URL appearing as a bare autolink in the same body must
still red-flag (`not-embedded`):

https://img.shields.io/badge/comment-control.svg
