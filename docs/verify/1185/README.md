# #1185 skill import evidence and registration failure

Live stack: server 8791, vite 5273, fresh `PACMAN_HOME`. Probe
`drive-1185-import-rollback.mjs` blocks `skill-sources.json` by replacing
that path with a directory, so the atomic rename fails after
`createLocalSkill`.

Before (`before/result.json`, 6/6 on the pre-fix server):

- import returns 500
- the skill directory and its create audit row remain (`creates=1`)
- the skill is listed
- after the blocker is removed, refresh in the same process returns 200
  (`before/snapshot.json`). The empty source record was one shared object.
  The failed write had already put the new row on it, so the next read
  treated the skill as imported.
- a second import is 409 `skill directory orphan-1185 already exists`

After (`after/result.json`, 7/7):

- import still returns 500
- the directory, the create audit row, and the list entry are gone
- refresh is 404 `skill orphan-1185 not found`
- the same name imports again with 201, and the source file has the row

`drive-1170-skill-import.mjs` on this tree: 31/31, every `ok` a boolean,
including B1 (`probe-1170/result.json`). `docs/verify/1170/result.json` is
31 checks, each `ok` a boolean. The README count matches.

Unit repro before the rollback (`unit-fail.txt`): the directory was still
there, and `readSkillSource` returned the row the failed write had stored
on the shared empty record. After: `unit-pass.txt`, 35 passed.

```sh
node .claude/skills/verify-pacman/scripts/cleanup.mjs
node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-1185-import-rollback.mjs --expect=new
VERIFY_EVIDENCE_DIR=/tmp/1185-probe-1170 \
  node .claude/skills/verify-pacman/scripts/drive-1170-skill-import.mjs
```

Rerun on a fresh launch. The server process is tsx without watch, so it
keeps the tree it started with.
