# #1170 skill import channels (localPath + GitHub URL + refresh) — live evidence

- probe: `.claude/skills/verify-pacman/scripts/drive-1170-skill-import.mjs`
- run date: 2026-10-10 (stack = worktree live stack, server 8795 / vite 5277 / an isolated `PACMAN_HOME` scratch; the server started with `NODE_USE_ENV_PROXY=1` — outbound GitHub goes through the local proxy, the deployment shape recorded in the `lib/github.ts` header note)
- reading: `result.json` checks 31/31 all PASS, each `ok` is a boolean; the red-state face (group D) is a real refusal, not simulated.

| group | coverage | key ground truth |
|---|---|---|
| A | localPath import (web real-user path: topbar import button → dialog → submit) | `a-localpath-list.png`, `a-import-rest-rows.json` (record + 12 files matched against the on-disk file set), `sources-records.json` (kind=localPath + realpath ref) |
| B | GitHub URL import (the real anthropics/skills subdirectory skills/pdf, 12 files) | `b-github-list.png`, `sources-records.json` (kind=github + canonical URL incl. ref) |
| C | refresh re-pull + materialization relay | `c-manifest-before.json` / `c-manifest-after.json` (same id `my-live-skill`, SKILL.md sha256 `9dfa1e23…` → `fb01a52d…`), `c-skill-audit-rows.json` (create x2 + update x2, actor=member), C1 hand-built skill 409 note |
| D | red-state face (real refusals) | `d-red-states.json`: SSRF per-shape (http://127.0.0.1, private segment 192.168.1.5, non-GitHub host), localPath landing inside the skill root, binary files, over the per-file limit (512001 > 512000); `d-red-ui.png` = inline error line in the dialog + the server's original text |

## Historical boundary (superseded by YAML support)

- The 2026-10-10 run used the former minimal parser: folded frontmatter such as `description: >` produced an import 400 "description is required". That result describes the measured version, not the current contract. The YAML adapter now accepts non-empty string scalars, including folded and literal block scalars; import targets no longer require single-line descriptions. Current parser and regression evidence: [foundation library replacement](../../research/foundation-library-replacement-2026-11-09.md).
