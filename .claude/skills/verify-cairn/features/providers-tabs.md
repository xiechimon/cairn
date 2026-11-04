# Model-service runtime tabs (providers page, spec 11 A1-A4/A7, #353/#354)

Users open the model-services page (`/app/resources/providers`) and see two runtime tabs, `pi` and `Claude Code`: each tab's header card carries the runtime name, a one-line description, and which machine it runs on (`已安装在 <hostname>` / the not-installed guide), and inside the tab are that runtime's model rows (display name -> model id). pi's models come from the user's configured custom providers; Claude Code's models come from each executing machine's daemon reading its local `~/.claude/settings.json`, reporting through presence/enroll, and the server aggregating per machine (#707). The `Cairn（内置）` facade row is removed, the page no longer promises a nonexistent remote-hosted service. Spec source: `docs/spec/11-model-service-and-machine-localization.md` (A1-A4/A7 + the model-sources data contract).

## Sub-features

- `prov-tablist` the tablist = exactly two tabs: `pi` / `Claude Code` (no `内置` wording; Codex is a later ticket). Contract handles: `[role="tablist"]` + `[role="tab"][data-runtime="pi"|"claude-code"]` + `aria-selected`, pi selected by default.
- `prov-tab-url` the tab state syncs the `?runtime=pi|claude-code` search param — refresh/share can relocate, a deep link lands directly on the corresponding tab.
- `prov-runtime-head` each tab's header card (`[data-testid="runtime-head"][data-runtime]`): runtime name + one-line description + install state. The claude-code install state = reported by the executing machines (A4, revised by #707): each machine that has reported gets one header card — with a settings file -> `已安装在 <reported hostname>`; without a file -> the `未安装` guide state, no empty reports, no crashes; a machine that never reported (old daemon) has no card and receives no fake list.
- `prov-pi-models` the pi tab's model rows = the custom providers `models[]` projection (A3). Contract handles: `[data-model-id][data-runtime]`, the row text contains the display name and the model id.
- `prov-pi-empty` with no custom provider, the pi tab's empty state (`[data-testid="runtime-empty"]`) + a guide button opening the add-provider picker (A3; the picker surface is provider-picker.md).
- `prov-facade-gone` the `Cairn（内置）` facade row is removed (negative; a current leftover = a fixed decorative row rendered by the frontend, not data in the library).
- `prov-no-affordance` model rows are display-only with no handler -> no chevron / three-dot decorations are rendered (the negative handle = the in-row `[data-model-id] svg` / `[data-model-id] button` count 0 — the decoration classes retired with #944, the A7 semantics re-pinned as "display-only rows have nothing clickable about them").
- `prov-model-sources-api` `GET /api/teams/:id/model-sources` -> the pi first section + one claude-code section per reporting machine (fixed order: pi first + by machine name), consistent with the UI as dual truth (the data contract's single source is in shared); the envelope element shape `{runtime, installed, hostname, models[{id, name, slot?}]}` pinned per section (the machine-independent surface).

## How to get to it (user POV)

- Board sidebar `资源` -> `模型服务` (`/app/resources/providers`), lands on the pi tab by default.
- Clicking a tab switches; a URL carrying `?runtime=claude-code` deep-links straight to the Claude Code tab.
- Driving (`vp.mjs list providers-tabs` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive providers-tabs claude-bin-detection`: the Claude Code tab's install-state detection; also needs a real daemon (see the preconditions below).
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive providers-tabs runtime-tabs`: the pi / Claude Code tabs, the `?runtime=` deep link, the pi empty state; run before the picker; requires a fresh stack (the first drive after launch, otherwise it refuses to run).

## Driving it with verify-cairn

Preconditions:

1. `launch.mjs` brings the isolated stack up, `doctor.mjs` fully PASS. The claude-code segment is seeded by the probe itself over the public machine wire (create an API key -> enroll reporting claudeCode), no real daemon needed.
2. **Fresh DB**: the pi empty-state assertion requires no custom provider in the DB (same rule as the api-key probe) — run before `drive-provider-picker.mjs` (the picker's e2e creates a provider); re-verification = relaunch.
3. The claude-code segment's data source = **the values the probe seeds by reporting** (hostname=`verify-exec-1`, models `verify-cc-model-*`, deterministic; unrelated to the running machine's real `~/.claude/settings.json` — since #707 the server does not read the local file). The probe asserts UI = API = the reported values, three ways consistent.

- **Runtime tabs full chain.** **How to run:** `node <skill>/scripts/drive-providers-tabs.mjs` (self-sufficient, no daemon/seed) — 21 checks (since #707 + the enroll-executor-api and executor-following two): page ready -> tablist / two tabs / copy / default pi -> facade negative -> pi empty state -> the empty-state button opens the picker -> API-seed a custom provider (public REST, not the path under test, same rule as the search probe's seeding) -> the pi model rows hit the seeded models -> chevron/three-dot negative -> switch to Claude Code (aria-selected + ?runtime= sync) -> the model-sources API's two sections -> the envelope shape -> the header-card install-state branch -> the claude-code model rows' UI = API row counts -> the deep-link relocation.
- **Truth.** The `GET /api/teams/:id/model-sources` envelope (runtime/installed/hostname/models) cross-checked against the UI header cards and model rows; the seeded provider goes through `POST /api/teams/:id/providers` (the response 201 full record).
- **Verification state (2026-09-28, #354)**: the advance map (spec 11 A12) — before the implementation tickets (the model-sources endpoint + the providers page rewrite) land, this probe is **red**, each FAIL detail pointing at a spec clause; the red-state output is exactly the implementation ticket's acceptance checklist, and the implementation-ticket acceptance = this probe turning green + the evidence archived.

## Gotchas

- **Red-state semantics**: this probe precedes the implementation (A12 "the implementation ticket consumes it") — red != the harness is broken, do not bend the assertions to go green; when the implementation and the map conflict, change the map first (`/maintain-verification-skill`) and then the probe.
- **The contract handles were defined at T0**: the `data-runtime` vocabulary = `'pi'|'claude-code'` (same source as the machine `enabledRuntimes` PATCH vocabulary, a shared-constant single source); `[data-testid="runtime-head"]` / `[data-model-id]` / `[data-testid="runtime-empty"]` carriers follow this file, if the implementation wants to change a carrier, change the map first (**#944 carrier migration**: class-name hooks -> semantic/data-* carriers, the original `.res-runtime-head` / `.res-model-row` / `.res-runtime-empty` class names retired, assertion semantics unchanged); the negative handle = the in-row svg/button count 0 (the original `.res-row-chev` / `.res-row-more` decoration classes retired, the A7 semantics = "display-only rows have nothing clickable about them").
- Fresh-DB ordering: tabs first, picker second; reversed order false-reds the pi empty-state assertion (the DB already has the provider the picker e2e created).
- Both claude-code header branches are legal (installed true/false) — assert by branching on the model-sources API, do not hard-code `已安装`.
- `?runtime=` does not flip the live judgment (the live surface only looks at `?scenario=`), live URLs can safely carry it.
- The Codex tab is not asserted (A1: a later ticket extends it); the tab count being exactly 2 is the negative pin.
- The chief-model-select data-source switch (A10) is not in this probe — it belongs to T5, the option-list surface is laid separately.
