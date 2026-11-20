# First run and setup (C9)

First run is a setup page shown before a team's first project, not a dead-end error (the desktop app starts the local Runner itself, so a newcomer only sets up models). Source: `board/first-run-setup.tsx`, `board/first-run-checklist-model.ts`; measured by `e2e/first-run-setup.spec.ts` and `e2e/first-run-checklist.spec.ts`.

## Rules

Scope: `apps/web/src/board/first-run-` `apps/web/e2e/first-run-`

| Id | Rule | Check |
|---|---|---|
| C9 | First run is a setup page before the first project: two live-status steps (models, confirm settings), unskippable, closing into the conversation. | G `e2e/first-run-setup.spec.ts`, `e2e/first-run-checklist.spec.ts` |

Two steps with live status:

1. **Connect models** — the Coordinator needs a provider; a Claude Code sign-in serves tasks only. The provider list sits on the page with no dialog.
2. **Confirm settings** (`确认设置`) — a `模型` group with the Coordinator model only, which saves its rule, and one line saying tasks default to it and frequently used models are added later in settings (the task model row is gone; the Coordinator picks a task's model from the `常用模型` list on the Model page). On a Mac whose Coordinator computer is a Linux VM not yet downloaded, a `电脑` group under it with one default-off `Linux 虚拟机` switch, its size and one line of what it gives; confirming with it on starts the download, which otherwise waits for `下载` where the VM screen sits in the Computers panel.

A step finished elsewhere ticks itself. The page fills the window with no sidebar: welcome, step rail, language switch and the ink spiral drawn as far as the open step on one side, the open step on the other; stacked with a two-bar progress below 1024px. With both steps done it closes into the Coordinator conversation, with no create-project call to action. It cannot be skipped, so creating the first project always follows both steps. Once a project exists the composer chip carries the same model check and a Runner going offline. A machine that just enrolled reads `starting` from the machines list and counts as a Runner it already has (`docs/design/runner-offline-grace.md`), so a desktop app that starts its own Runner shows no chip during the start; one reported offline again shows the chip at once, with no client-side timer.
