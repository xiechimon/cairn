# Memory in-place edit: real-component fixture

Documentation-only draft for [memory-inplace-edit](../memory-inplace-edit.md), not a product route. It renders cairn's real `Button`, `Textarea`, `SegmentedTabs`, `IconTooltip`, `DialogShell`, fonts and tokens. The memory rows copy the #3666 row markup, and the edit card copies the question-card cap classes from `chief/chief-question-card.tsx`. The composer copies the classes of `ComposerSurface` rather than mounting it, because `ComposerSurface` needs the chat composer wiring (mentions, slash commands, attachments) that this surface drops. The word diff uses the installed `diff` package: a line diff first, then a word diff on paired changed lines, with an `Intl.Segmenter` so Chinese splits into words. All data is fictional, and no request leaves the fixture origin.

Two prototype-only overrides mark gaps for implementation:

- The dialog footer row (`DialogFootRow`) right-aligns buttons. The prototype stretches it so the composer fills the footer. Implementation needs a full-width footer slot.
- The phone close button is enlarged to 44px, as in the #3640 prototype.

## Reproduce

Run these from the repository root, with dependencies installed with scripts disabled. Check that port 8796 is free first.

```sh
node scripts/owned-process.mjs -- node docs/design/memory-inplace-prototype/serve.mjs
node docs/design/memory-inplace-prototype/capture.mjs
```

The capture visits 11 states at 1440 and 390 px in light and dark: 44 shots, with `results.json` next to them.

It asserts:

- 0 axe violations for the WCAG 2.0 A/AA, 2.1 AA and 2.2 AA tags (A3);
- no horizontal overflow (R1);
- every phone button outside the product header is at least 44×44 (A1);
- no request leaves `127.0.0.1:8796` and no `/api` call is made, so nothing reaches a main thread;
- per-state content: 3 ops with `del` and `ins` marks in the proposal, Stop while working, Undo after apply, the conflict alert, and the disabled composer offline.

The first run failed axe on two counts:

- struck-through text was too low in contrast on the delete tint;
- the scrollable diff list was not focusable.

Both are fixed in the fixture and recorded here as implementation rules. These are fixture measurements, not live-stack evidence.

## Screens

| State | Light 1440 | Dark 1440 | Light 390 | Dark 390 |
|---|---|---|---|---|
| Input, draft typed | [image](screens/input-light-1440.png) | [image](screens/input-dark-1440.png) | [image](screens/input-light-390.png) | [image](screens/input-dark-390.png) |
| Working | [image](screens/working-light-1440.png) | [image](screens/working-dark-1440.png) | [image](screens/working-light-390.png) | [image](screens/working-dark-390.png) |
| Clarification | [image](screens/clarify-light-1440.png) | [image](screens/clarify-dark-1440.png) | [image](screens/clarify-light-390.png) | [image](screens/clarify-dark-390.png) |
| Proposed diff | [image](screens/proposed-light-1440.png) | [image](screens/proposed-dark-1440.png) | [image](screens/proposed-light-390.png) | [image](screens/proposed-dark-390.png) |
| Applied, undo offered | [image](screens/applied-light-1440.png) | [image](screens/applied-dark-1440.png) | [image](screens/applied-light-390.png) | [image](screens/applied-dark-390.png) |
| Undone | [image](screens/undone-light-1440.png) | [image](screens/undone-dark-1440.png) | [image](screens/undone-light-390.png) | [image](screens/undone-dark-390.png) |
| Error: run gave no change | [image](screens/error-run-light-1440.png) | [image](screens/error-run-dark-1440.png) | [image](screens/error-run-light-390.png) | [image](screens/error-run-dark-390.png) |
| Error: apply conflict | [image](screens/error-conflict-light-1440.png) | [image](screens/error-conflict-dark-1440.png) | [image](screens/error-conflict-light-390.png) | [image](screens/error-conflict-dark-390.png) |
| Offline | [image](screens/offline-light-1440.png) | [image](screens/offline-dark-1440.png) | [image](screens/offline-light-390.png) | [image](screens/offline-dark-390.png) |
| Detail, scoped input | [image](screens/detail-input-light-1440.png) | [image](screens/detail-input-dark-1440.png) | [image](screens/detail-input-light-390.png) | [image](screens/detail-input-dark-390.png) |
| Detail, scoped proposal | [image](screens/detail-proposed-light-1440.png) | [image](screens/detail-proposed-dark-1440.png) | [image](screens/detail-proposed-light-390.png) | [image](screens/detail-proposed-dark-390.png) |

## Reference

claude.ai keeps a pinned "Tell Claude what to change" input on its memory list and detail panes. The owner's signed-in reference shots are in `~/.cache/ui-refs/claude-memory-ref-2026-11-09/redacted/` (personal text redacted) and are not committed. claude.ai's behavior after you send has not been observed (design open question 5). The working-card and diff states therefore have no reference shot. Their pattern is the Coordinator question card attached to the composer (#3580).
