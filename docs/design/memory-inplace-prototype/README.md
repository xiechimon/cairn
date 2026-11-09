# Memory in-place edit: real-component fixture (revision 2)

Documentation-only draft for [memory-inplace-edit](../memory-inplace-edit.md), not a product route. Revision 2 follows the owner's decisions on #3677: changes apply directly, and there is no apply, discard, undo or promote button. The page shows no size limit or counter.

How the fixture is built:

- **Components:** cairn's real `Button`, `Textarea`, `SegmentedTabs` and `IconTooltip`, with the product fonts and tokens.
- **Sections:** following the #3666 restyle, `每个线程都会读` shows one `MEMORY.md` per scope, and `记忆文件` lists the memory files.
- **Edit card:** copies the question-card cap classes from `chief/chief-question-card.tsx`.
- **Composer:** copies the classes of `ComposerSurface` rather than mounting it. `ComposerSurface` needs the chat wiring (mentions, slash commands, attachments) that this surface drops.
- **Word diff:** read-only. It uses the installed `diff` package: a line diff first, then a word diff on paired lines, with an `Intl.Segmenter` so Chinese splits into words.
- **Data:** all fictional. No request leaves the fixture origin.

## Reproduce

Run these from the repository root, with dependencies installed with scripts disabled. Check that port 8796 is free first.

```sh
node scripts/owned-process.mjs -- node docs/design/memory-inplace-prototype/serve.mjs
node docs/design/memory-inplace-prototype/capture.mjs
```

The capture takes 4 states at 1440 and 390 px, in light and dark: 16 shots, plus `results.json`.

It asserts:

- 0 axe violations for the WCAG 2.0 A/AA, 2.1 AA and 2.2 AA tags (A3);
- no horizontal overflow (R1);
- every phone button is at least 44×44 (A1);
- no request leaves `127.0.0.1:8796` and no `/api` call is made;
- the edit card holds no button;
- no button named `应用修改`, `放弃`, `撤销` or `提升为团队记忆` exists;
- no `上限`, `n / m` counter or KB text appears;
- Stop shows while working;
- after apply, two changed documents and `刚刚更新` appear;
- the error state shows an alert.

These are fixture measurements, not live-stack evidence.

## Screens

| State | Light 1440 | Dark 1440 | Light 390 | Dark 390 |
|---|---|---|---|---|
| In-place input, draft typed | [image](screens/input-light-1440.png) | [image](screens/input-dark-1440.png) | [image](screens/input-light-390.png) | [image](screens/input-dark-390.png) |
| Working | [image](screens/working-light-1440.png) | [image](screens/working-dark-1440.png) | [image](screens/working-light-390.png) | [image](screens/working-dark-390.png) |
| Applied, read-only diff | [image](screens/applied-light-1440.png) | [image](screens/applied-dark-1440.png) | [image](screens/applied-light-390.png) | [image](screens/applied-dark-390.png) |
| Error, sentence returned to the composer | [image](screens/error-light-1440.png) | [image](screens/error-dark-1440.png) | [image](screens/error-light-390.png) | [image](screens/error-dark-390.png) |

## Reference

claude.ai keeps a pinned "Tell Claude what to change" input on its memory list and detail panes. The owner's reference shots are in `~/.cache/ui-refs/claude-memory-ref-2026-11-09/redacted/` and are not committed.

What claude.ai does after you send has not been observed: the owner's account stays untouched. The Claude Code `MEMORY.md` shape and its load bound come from its docs (research §0a).
