# #1258 verification evidence — the failure row's "view raw error / troubleshooting guide" made clickable

Two legs, mapping one-to-one to the ticket's three acceptance items:

## 1. Live-stack real-user path (`live/`, drive-1258-fail-links 9/9 PASS)

The machine wire (the probe plays the machine, on the same endpoint as the daemon) pushes a todo to failed
(a plan step done(failed) → applyStepFailure → build.errorMessage + todo
failed), and the browser leg really clicks on the detail page. The three ground-truth kinds:

| file | content |
|---|---|
| `live/result.json` | the 9 checks itemized ok (wire / SQLite / UI three faces) |
| `live/fail-row.png` | the failure row's shape (full title text + a real `查看原始错误` button, the troubleshooting guide absent) |
| `live/raw-error-dialog.png` | the dialog open state (accessible name `原始错误`, the body = the errorMessage full text, 1385 characters multi-line byte for byte) |
| `live/dialog-closed.png` | collapsed after X closes it |

Key criteria (mapped to the ticket acceptance):

- **Acceptance 1 (when there is a raw error, opening it shows the full error text)**: the dialog
  `[data-testid="fail-raw-error"]`'s textContent is **byte-equal** to build.errorMessage
  (1385 characters, multi-line, leading and trailing markers in place) — the
  `ui: 弹窗正文 = errorMessage 全文逐字节（多行不截断）` row of `live/result.json`.
- **Acceptance 2 (the troubleshooting guide lands at the right doc position)**: the repo has no
  "build-failure troubleshooting" doc section and no doc site to link to (the same law as the #136 "view docs" wontfix) — per the ticket's ruling "when there is no corresponding doc section, treat it as the non-clickable state", it is judged **not rendered**, and the `ui: 排查指南死链不渲染` row pins `getByText('排查指南')` count 0.
- **Acceptance 3 (the non-clickable state when there is no content)**: the failure row is structurally
  guaranteed by the mapper gate (only a non-empty errorMessage produces a row) that `查看原始错误` has no contentless state; the wire/SQLite two rows pin the errorMessage full text in place = the runtime ground truth of that premise.

Rerun recipe (from the worktree root):

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs        # isolated stack (8791/5273, fresh library)
node .claude/skills/verify-pacman/scripts/drive-1258-fail-links.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

The probe self-seeds (provider → API key → machine enroll → agent → hosted project →
todo → build → claim → done(failed)), and the error text's wording avoids the
quota/capacity/network buckets of classifyStepFailure (the quota bucket would hold instead of failing).

## 2. The fixture-face e2e (dead-buttons.spec.ts section 17, rerunnable in-repo)

`apps/web/e2e/dead-buttons.spec.ts`, two cases (scenario 54 = the r8-12 failure detail):

- `fail row 查看原始错误 opens the raw-error dialog with the full text (#1258)`
  — a button click → the dialog family opens → the full text verbatim → X closes and collapses.
- `fail row drops the 排查指南 dead link — no doc target, no shape (#1258)`
  — positive control (the failure row present) + zero dead-link rendering + what remains is a real button.

```sh
cd apps/web && pnpm exec playwright test dead-buttons.spec.ts -g "#1258"
```

Test-first: measured red before the implementation (the button absent / the dead link present), green after.
