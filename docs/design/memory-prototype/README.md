# Memory real-component design fixture

This is a documentation-only draft, not a product route. It imports Cairn's real `ListCard`/`ListRow`, `SettingsCard`, `EmptyState`, `Button`, `Skeleton`, `DialogShell`, `AlertDialogShell`, fonts and tokens. Data is fictional; no request reaches a product server. The standalone content specimen omits the surrounding settings navigation so it cannot be mistaken for a shipped screen.

## Reproduce

Use the installed repository dependencies; no package installation or lockfile change is needed. Check that port 8791 is free before starting. Start exactly one fixture server and one browser instance in this worktree:

```sh
node docs/design/memory-prototype/serve.mjs
```

Open `/docs/design/memory-prototype/index.html?state=populated&theme=light` on that server. In another terminal:

```sh
B1_SCREEN_DIR="$HOME/.cache/codex-scratch/pi-146/screens" node docs/design/memory-prototype/capture.mjs
```

The capture script starts one headless Chromium, visits 13 states at two widths in two themes, rejects requests outside the isolated origin, and records `results.json`. It asserts zero axe violations for WCAG A/AA/2.1/2.2 tags, no horizontal overflow, focus restored after keyboard opening/closing detail, safe initial confirmation focus and no hover shadow/position change or delayed hover. Reduced motion is enabled. Pending/error states are explicit fixtures, not delayed network requests or injected product failures.

The red-first check failed on the missing Coordinator settings heading before the prototype existed. The final run produced 52 screenshots with zero reported violations. These are not product e2e results. API authorization, database mutation, query invalidation and live recovery remain implementation tests named in the designs.

## Fixture screenshots

| State | Light 1440 | Dark 1440 | Light 390 | Dark 390 |
|---|---|---|---|---|
| Empty | [image](screens/empty-light-1440.png) | [image](screens/empty-dark-1440.png) | [image](screens/empty-light-390.png) | [image](screens/empty-dark-390.png) |
| Loading | [image](screens/loading-light-1440.png) | [image](screens/loading-dark-1440.png) | [image](screens/loading-light-390.png) | [image](screens/loading-dark-390.png) |
| Read error | [image](screens/error-light-1440.png) | [image](screens/error-dark-1440.png) | [image](screens/error-light-390.png) | [image](screens/error-dark-390.png) |
| Populated | [image](screens/populated-light-1440.png) | [image](screens/populated-dark-1440.png) | [image](screens/populated-light-390.png) | [image](screens/populated-dark-390.png) |
| Long detail | [image](screens/long-light-1440.png) | [image](screens/long-dark-1440.png) | [image](screens/long-light-390.png) | [image](screens/long-dark-390.png) |
| Offline | [image](screens/offline-light-1440.png) | [image](screens/offline-dark-1440.png) | [image](screens/offline-light-390.png) | [image](screens/offline-dark-390.png) |
| Detail | [image](screens/detail-light-1440.png) | [image](screens/detail-dark-1440.png) | [image](screens/detail-light-390.png) | [image](screens/detail-dark-390.png) |
| Promote | [image](screens/promote-light-1440.png) | [image](screens/promote-dark-1440.png) | [image](screens/promote-light-390.png) | [image](screens/promote-dark-390.png) |
| Promote pending | [image](screens/promote-pending-light-1440.png) | [image](screens/promote-pending-dark-1440.png) | [image](screens/promote-pending-light-390.png) | [image](screens/promote-pending-dark-390.png) |
| Promote error | [image](screens/promote-error-light-1440.png) | [image](screens/promote-error-dark-1440.png) | [image](screens/promote-error-light-390.png) | [image](screens/promote-error-dark-390.png) |
| Delete | [image](screens/delete-light-1440.png) | [image](screens/delete-dark-1440.png) | [image](screens/delete-light-390.png) | [image](screens/delete-dark-390.png) |
| Delete pending | [image](screens/delete-pending-light-1440.png) | [image](screens/delete-pending-dark-1440.png) | [image](screens/delete-pending-light-390.png) | [image](screens/delete-pending-dark-390.png) |
| Delete error | [image](screens/delete-error-light-1440.png) | [image](screens/delete-error-dark-1440.png) | [image](screens/delete-error-light-390.png) | [image](screens/delete-error-dark-390.png) |

## Reference comparison and limits

[Memory design](../memory.md) names the Claude Manage/Topics reference and lists the per-state differences. The official article establishes topic read/edit/delete behavior, not measured styles. No signed-in reference session is exposed in this environment, so exact reference shots, computed styles, a 60fps operation recording and owner selection are still missing. No fixture image is labelled as a reference or live-stack screenshot. The registry frontend gap remains open.
