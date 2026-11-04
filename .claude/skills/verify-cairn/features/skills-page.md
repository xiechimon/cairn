# Skills page (local directory live-scan surface)

Users drop a subdirectory containing a `SKILL.md` into the skill directory on the server machine (for the verification stack = `<RUN_DIR>/home/skills`, launch already isolates it via `CAIRN_SKILLS_DIR`), refresh the cairn skills page (`/app/resources/skills`) and see it — the data source is still the directory live scan, but the create/edit UI entries have been restored (XMON-114, spec 13 swing-back: the topbar `新建` and the empty-state primary button open the SkillDialog, a row click opens edit); there is still no import route. Skill rows can be granted to Agents (`agent.skills[]` stores the skill id); deleting the directory deletes the skill, the page has no delete surface. Spec source: spec 13 resource-surface localization (#367) + the XMON-114 write-surface swing-back.

## Sub-features

- `live-scan` the skill list = the directory live-scanned on every `GET /api/skills?teamId=` (no cache, not in the DB): drop a directory -> it appears on refresh, delete the directory -> it vanishes on refresh.
- `identity` the row identity id = the `SKILL.md` frontmatter `name`, falling back to the directory name when there is no frontmatter / no name (contract revision 2026-09-29, aligned with spec 14); `name`/`description` also come from the frontmatter, defaulting to the directory name / null.
- `write-entries` the create entry is in place (restored at XMON-114, pinned by skills-page.spec.ts at count 1): the topbar `新建` = role=button with the exact copy `新建` (CSS carrier `[data-testid="resource-new"]`), the empty-state primary button `新建技能` opens the SkillDialog; no import route (`/app/resources/skills/import` redirects back to `/app`); the empty-state copy points at the skill directory (the `~/.agents/skills` default display) + the UI's dual create entries.
- `agent-grant` the Agent row's `skills[]` only accepts live-scan-known ids: an old id whose directory was deleted is silently filtered, no error.

## How to get to it (user POV)

- Sidebar `资源 → 技能` -> `/app/resources/skills`.
- Empty state: when the scratch skill directory is empty, the list page is in the empty state (the copy includes the directory path).
- Direct API proof: `GET <api>/api/skills?teamId=<teamId>`.
- Driving: the registry has no case for this feature, `vp.mjs list` does not list it; drive it manually per the recipe below.

## Driving it with playwright

Preconditions: `launch.mjs` stack up (the scratch skill directory is empty); read `skillsDir`/`serverPort` from `ports.json`; teamId via `GET /api/teams`.

- Drop a skill directory -> the row appears on a page refresh:
  `mkdir -p <skillsDir>/deploy && printf -- '---\nname: deployer\ndescription: 部署流程手册\n---\n# deploy\n' > <skillsDir>/deploy/SKILL.md`
  -> browser reload `/app/resources/skills` -> `[data-testid="resource-row"]` count 1, the row text contains `deployer` (the frontmatter name takes precedence over the directory name deploy) and the description.
- The API truth as the second pair of eyes:
  `curl -s <api>/api/skills?teamId=<teamId>` -> `[{id:"deployer",name:"deployer",description:"部署流程手册",teamId:<teamId>}]`.
- Delete the directory -> it vanishes on refresh:
  `rm -rf <skillsDir>/deploy` -> reload -> `[data-testid="resource-row"]` count 0, the empty-state `[data-testid="resource-empty"]` is visible and the copy contains the `~/.agents/skills` wording while **the actually configured directory is not displayed** (the empty state's {dir} is the default-constant display slot, see Gotchas).
- Write-surface / import-surface pins:
  On `/app/resources/skills` the `新建` entry count is 1 (role=button with the exact copy `新建` / `[data-testid="resource-new"]`; restored at XMON-114 — the old "no create button, count 0" wording is void); goto `/app/resources/skills/import` -> the URL lands at `/app`.
- No-frontmatter fallback:
  `mkdir -p <skillsDir>/plain && echo '# plain' > <skillsDir>/plain/SKILL.md` -> the row id/name = `plain`, the description empty.
- agent-grant tolerance (optional, API surface):
  `POST /api/teams/<teamId>/agents {displayName:"x",skills:["deployer","ghost"]}` -> `GET agents/<id>`'s `skills` = `["deployer"]` (ghost silently filtered).

## Gotchas

- **The empty-state copy shows the default path constant `~/.agents/skills`, not the server's actually configured directory** — the verification stack's scratch directory is overridden via `CAIRN_SKILLS_DIR`, yet the empty state still shows the default value (the web-side {dir} = the shared SKILLS_DIR_DEFAULT single source; the env override only takes effect on the server). Do not judge this as a bug, just note it in the evidence.
- Case-sensitive: `skill.md` (lowercase) does not count as a skill (the canon name `SKILL.md` matches exactly, forced exact even on a case-insensitive filesystem).
- Only first-level subdirectories are scanned: a `<skillsDir>/a/b/SKILL.md` will not have its b discovered; only an a that carries its own SKILL.md is collected.
- Symlinked directories are collected and deduplicated by realpath (two entries of the same real directory yield one row); two directories declaring the same name in their frontmatter = the lexicographically-first directory name wins.
- The skills-page sort button / search row are pure frontend surfaces (isomorphic across fixture and live), unrelated to the data source.
- After verifying, clean the scratch skill directory back to the empty set before verifying the empty state (directory leftovers = the empty state never shows).
- **#944 carrier migration**: class-name hooks -> semantic/data-* carriers (`.res-rowcard` -> `[data-testid="resource-row"]`, `.res-empty` -> `[data-testid="resource-empty"]`, `.res-new` -> role=button `新建` / `[data-testid="resource-new"]`; assertion semantics unchanged). The same ticket fixes known drift: this page's old wording "no create button (count 0)" is void since the XMON-114 create-entry restoration, now pinned at count 1 (skills-page.spec.ts pins the same).
