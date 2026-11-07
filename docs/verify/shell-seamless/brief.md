# Shell continuity brief

Surface: Coordinator chat, thread list and sidebar, thread and review.
Goal: One continuous sidebar canvas around one inset sheet; full rounded decision rows.
Rules: P1, P3, P5, V1, V4, V7, V8, R1.
References: `docs/design/references/coordinator-chat/claude-ai-empty-composer.jpg` (opened: quiet canvas and inset composer); `docs/design/references/thread-review/t3code-done-changed-file-card.png` (contained thread cards).
Draft: exempt, fix to existing screen with the owner's explicit layout direction.

| Component | State | Evidence |
|---|---|---|
| Shell and decision tray | conversation, long titles, confirm/failed/review, offline setup, light/dark, 1440 | Seeded live server, before/after images |
| Thread pane | review action, transcript/spec, composer, light/dark, 1440 | Same live images and fixture geometry tests |
| Shell and tray | 390px, light/dark, thread closed/open | Fixture geometry and screenshots |
| Empty/loading/error | Existing behavior; no state logic changes | Existing affected e2e; no dedicated new screenshot |

Failure modes: sheet shadow paints a band over canvas; missing left margin breaks even inset; vertical scrolling also clips horizontal overflow, cutting an external row ring; insufficient bottom padding clips the last row; a panel shadow adds another layer; narrow layouts overflow after new spacing.

Plan: establish failing geometric e2e, capture before, remove shell elevation and provide even inset, reserve scroll padding for row elevation, check pane/composers, run affected checks, capture and inspect after, prepare handoff files.

Acceptance: gutter effective computed background equals sidebar in both themes; 8px sheet inset on desktop; rows have symmetric 8px clearance inside scrollport; card/composer edges fit every clipping ancestor; pane shares sheet top/bottom without another shadow; 390px has no horizontal overflow.
