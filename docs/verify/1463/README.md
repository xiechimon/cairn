# #1463 evidence: an e2e helper change selects the specs that use it

Environment: cloud session image, Node 22, `scripts/e2e-affected.mjs --dry-run` with explicit paths. Nothing here starts a browser except `e2e-affected-helpers-run.txt`.

| file | what it shows |
|---|---|
| `dry-run-old-leg.txt` | the script on main `23a39da`: `helpers.ts`, `probe-dump.mjs` and `palette-c.css` each fall back to the full suite (169/169); `evidence.ts` is full by its own rule; `live-server-tether.mjs` uses its file rule (2 specs) |
| `dry-run-new-leg.txt` | the same paths on this branch: `helpers.ts` → `imported by 17 specs`; `probe-dump.mjs` → `FULL (the playwright config or package.json names probe-dump.mjs)` (an `apps/web/package.json` script runs it); `palette-c.css` → `FULL (... is not a top-level e2e module)`; `evidence.ts` and `live-server-tether.mjs` are unchanged |
| `dry-run-edge-cases.txt` | temporary files, removed afterwards: a chain `zz-chain-leaf.ts` ← `zz-chain-mid.ts` ← `zz-chain-a.spec.ts` ← `zz-chain-b.spec.ts` selects both specs; a module a spec names as a spawn path, a `.png` in a template literal, a file in a subdirectory, a dotfile, a new untracked directory and a file `playwright.config.ts` names each run the full suite, with the reason printed |
| `e2e-affected-helpers-run.txt` | `pnpm --filter @pacman/web e2e:affected -- apps/web/e2e/helpers.ts` on the final code: the 17 specs run, 160 passed (1.5m) |

The scan only narrows, and only where every mention of the file is a static relative import between top-level e2e modules. A reference built at runtime (`readdirSync`, string concatenation) or any mention outside an import keeps the full-suite fallback.
