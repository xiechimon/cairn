# Shell continuity and hairline verification (#3341)

Live isolated stack at 1440x900 (scratch SQLite, no API interception, no provider calls), thread panel open, two needs-you rows. `before-*` is `origin/main`; `after-*` is this branch. `*-runtime.json` holds computed styles and bounds per capture.

| Check | Main | This branch |
|---|---|---|
| Gutter between sidebar and card | Card flush to the sidebar at x=248; its `--e1` shadow pool paints a different band | 8px gutter, the sidebar color (`rgb(230, 231, 225)` light, `rgb(20, 23, 21)` dark) |
| Card edge | 1px ring drawn by `--e1` | 1px `--border` border, no shadow, 14px radius |
| Conversation / panel divider | 1px inset shadow | 1px `--border` left border, no shadow |
| Needs-you rows | Row ring clipped at the scrollport's left edge | 8px scrollport padding; full ring visible, same row width |

Crops are 6x nearest-neighbour zooms of the live captures: `*-needs-edge.png` (left edge of the first needs-you row), `*-divider.png` (conversation / panel line), `*-gutter.png` (sidebar to card corner). Fixture captures (`*-fixture.png`, `after-390-*`) cover the three-row tray and 390px, and are labelled fixture.

Covered by e2e: `chief-home-shell-seamless.spec.ts` asserts the 1px card border, the divider and the continuous gutter at 1440 in both themes.
Not covered: production data, real providers.
