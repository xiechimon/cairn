# Skill import channel (skills page + server collector + refresh, #1170)

The existing only channel for skills entering the server library is web-form/API manual creation (`createLocalSkill`); #1170 adds a second: **import** - `POST /api/teams/{id}/skills/import` (body `{localPath}` or `{url}`, one of two) + **refresh** `POST /api/teams/{id}/skills/{sid}/refresh` re-pulls by the record's source (id unchanged, reusing `updateLocalSkill`'s overwrite semantics). The disk write always reuses createLocalSkill/updateLocalSkill's existing validation (directory-name regex / frontmatter sole truth / byte gate / audit row), **no separate write path** - `services/skill-import.ts` only does "turn the source into a CreateSkillBody".

The source record (refresh's data source) lands in the **data-root sidecar** `<CAIRN_HOME>/server/skill-sources.json`: the skill body is the live-scan directory (spec 13 #367 "not stored in DB" domain law), the source registration likewise does not enter the DB - zero migration, no pollution of the user's skill-pool directory. Key = skillId; value = `{kind: localPath|github, ref, importedAt, refreshedAt}` (ref: localPath = realpath normalized; github = canonical URL including ref - refresh re-pulls deterministically).

Security face (ticket-face hard requirement): the URL branch's user input is only a "spec" not a "fetch target" - the actual outbound only hits **fixed hosts** (api.github.com / raw.githubusercontent.com), owner/repo/ref/subpath first pass a character allowlist; input validation still explicitly rejects non-https and private-network/loopback/link-local hosts (a user pasting a wrong intranet address gets a named error). localPath: after resolve+realpath normalization falling inside the skill root = 400 (already managed by cairn's live scan); any readable directory outside the root = the local-form trust face (the server process permission = the operator themselves). Read-only copy (zero writes to the source directory); the walk does not follow symlinks (listSkillFiles same law); `.git` not packed. Binary files explicit 400 (the write face's body is utf8 text; Multica skips because of the PG TEXT column - cairn's write-face discipline is explicit rejection, see the `skill-import.ts` header note).

## Sub-features

- `skill-import-local` localPath import: collector read-only walk + per-file byte gate + utf8 strict decode -> createLocalSkill. A source inside the skill root (including after symlink resolution) -> 400 "it is already visible to cairn".
- `skill-import-url` GitHub URL import: repo meta (default branch) -> recursive tree (truncated = 400) -> subdirectory prefix filter + path guard + **tree-declared size pre-check** (over-limit rejected before fetching, zero raw requests) -> per-file raw fetch (15s timeout per request + 120s overall deadline + content-length/actual-read dual cap) -> utf8 strict. File-count cap 256 [design] (Multica's maxImportFileCount same magnitude - one outbound request per file).
- `skill-refresh` refresh re-pull: no source record -> 409; frontmatter name != sid (source identity drift) -> 409 rejected, disk untouched; after passing, updateLocalSkill overwrites (**listed overwrites, unlisted keeps** - a file the source deleted stays locally, same law as manual PUT). After refresh the materialized manifest's sha256 changes -> the new digest view (#920 handoff, zero extra changes).
- `skill-import-wire` web face: the skills page topbar `导入` button (`data-testid=resource-import`, the ResourceShell headerExtra slot's first use) opens `SkillImportDialog` (localPath / GitHub URL two fields, client-side xor pre-check, 400/409/502/504 land in an inline error row).

## How to get to it (user POV)

- Sidebar `资源` -> `技能` -> `/app/resources/skills` -> topbar `导入` button (data-testid=resource-import) -> the import dialog, local path and GitHub URL one of two.
- API: `POST /api/teams/{id}/skills/import`, `POST /api/teams/{id}/skills/{sid}/refresh`.
- Driving (`vp.mjs list skill-import` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive skill-import import-rollback`: import-failure rollback, retry success writes the source record (default carries the post-fix switch `--expect=new`).
  - `env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' node .claude/skills/verify-cairn/scripts/vp.mjs drive skill-import local-and-github-import`: local-directory and GitHub-URL import, refresh, i.e. the driving steps below; it calls GitHub, drive without `--force` refuses and lists why, add `--force` yourself after confirming you want to hit GitHub; launch with `NODE_USE_ENV_PROXY=1` (Gotchas 1).

## Driving steps (drive-1170-skill-import.mjs)

1. `launch.mjs` starts the stack (**the command line carries `NODE_USE_ENV_PROXY=1`** - see gotcha 1).
2. `env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' node
   .claude/skills/verify-cairn/scripts/drive-1170-skill-import.mjs`.
3. Reading = `docs/verify/1170/README.md` (A/B/C/D six faces 31 checks, each `ok` is a boolean).

## Gotchas

1. **The stack's GitHub outbound must go through the proxy**: a direct connection to raw.githubusercontent.com intermittently resets (api.github.com is stable); launch's command line carries `NODE_USE_ENV_PROXY=1` (Node fetch by default ignores the proxy env - lib/github.ts header note's deployment form).
2. **anthropics/skills has subdirectories with folded single-line descriptions**: `skills/academy-guide`-style `description: >` folded shapes fall back to the default in parseSkillFrontmatter -> import 400 (existing parse semantics, not a defect); `skills/pdf` is the safe target.
3. Phase B runs the real network (14 outbound requests) - on network jitter just re-run, phases A/C/D have zero external-network dependency and can be located alone.
4. The fake-machine materialization leg (C5-C7) walks the full REST chain (api-key -> enroll -> agent allowlist -> build -> claim -> manifest), the claim response is `{step:{step,...}}` double-wrapped - `.step.step.id` (the #519 same pit).
5. The source-record assertion must `realpathSync` cross-check - the macOS `/var -> /private/var`-family transform makes bare equality a false red (this stack is under /Users so no issue here, a general guardrail).

## Verification account

- live: `drive-1170-skill-import.mjs` 31/31 PASS, evidence `docs/verify/1170/` (2026-10-10). When source registration fails the import deletes the just-created directory (#1185), the same name can be imported again.
- server unit: `apps/server/test/skill-import.test.ts` 35 cases (failure modes enumerated first - LP0-LP11 / U1-U11 / R1-R8 / M1 / W1, plus the empty source registration not polluted by a failed write).
- web e2e: `apps/web/e2e/skill-import.spec.ts` 4 cases (the fixture field set + xor gate + accept law; live 201/400/409 stubbed).