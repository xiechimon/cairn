Paper Grouped sidebar (apps/web/docs/paper-redesign-plan.md PR 5): new probe `scripts/drive-paper-sidebar.mjs`.

Pure live stack, no daemon, no LLM. Seeds three projects and six todos over REST, then moves four todos to confirm / failed / building / done with a direct `UPDATE todo SET phase` on the scratch SQLite (manual gate-phase PATCHes answer 409 on the live server). Browser leg in the light theme with real clicks: expanded sidebar (248px, `需要我处理` badge = `待处理` column count, project row counts exclude done), `资源` open + persisted across reload, `需要我处理` filter (`?column=pending`, one column, active row) and the topbar chip back out, collapse to the 40px rail.

Run: `VERIFY_REPO_ROOT=<worktree> VERIFY_EVIDENCE_DIR=<worktree>/docs/verify/paper-sidebar node .claude/skills/verify-pacman/scripts/drive-paper-sidebar.mjs` after `launch.mjs`. Evidence: `docs/verify/paper-sidebar/`.

The machine-status line reads `0 台机器在线` on this stack: no daemon registers a machine.
