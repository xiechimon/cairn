# Post-install regressions

The regression list behind `scripts/smoke/post-install.mjs`, which the
`desktop-release` workflow runs on the packaged arm64 app before `publish`
(`post-install smoke` step in `.github/workflows/desktop-release.yml`).

Every behavior below reached production broken at least once after being
verified fixed. Each row names the check id printed by the script, the user-
visible symptom, and the release that shipped the regression.

| check | regression it guards | first broken release |
| --- | --- | --- |
| `migration` | Server never comes up on a database with real rows: a migration `DROP TABLE` hits a foreign key on populated child tables (`im_connection` + `im_pairing_request`/`im_seen_inbound`/`im_turn_origin`). Fixture DBs were empty, so unit tests stayed green. | 0.1.536 |
| `models` | Settings → Model → Frequent models: the SWE-2 row renders `unavailable` although an active Devin subscription can provision it; thinking levels Default (High)/Medium/High/Max missing. Fixed by `3ae0f5ce9`, first shipped in 0.1.536. | 0.1.526–0.1.535 |
| `runner` | The bundled local Runner never reports presence; the machines list shows this Mac offline forever. | — |
| `menu` | Coordinator chat loses native context-menu entries: copy, copy image, save image as, copy link, paste, look up. | — |
| `attachment` | A finished file attachment tile renders no type icon, or the floating lightbox/pager stops opening. | — |
| `remote` | Remote access switch fails to render or shows a state that differs from the persisted `tsnet-remote.json`. | — |
| `start-task-echo` | Starting a task leaks synthetic `开始任务 #N` / `编排请求` prompts into the main Coordinator chat, renders `#N` in the task thread notice instead of the task title, or emits a redundant in-thread orchestration toast (S10, fixed by `40a5af0d0`). | — (fixed in 0.1.736) |
| `settings-titlebar` | Narrow (`760px`) full-window Settings overlay header (`h1` or close button) overlaps the top-left macOS traffic-light zone or loses its draggable titlebar region (S13, fixed by `1734a565e`). | — (fixed in 0.1.737) |
| `ime-composition` | Blurring the composer or firing `compositioncancel` during IME input leaves composing state stuck so subsequent `Enter` presses fail to send (S14, fixed by `bcb383cda`, `906d76aeb`). | — (fixed in 0.1.737–0.1.738) |
| `server-version` | Settings About / Host version badge falls back to `Unknown version` on untagged builds with a commit SHA or leaks an untruncated SHA instead of rendering `<version> · <sha7>` or `Dev · <sha7>` (S5, fixed by `606d9c2ec`, `589f305c0`). | — (fixed in 0.1.733–0.1.734) |

## Adding a regression

When a verified fix later regresses in a shipped build:

1. Add a row above: check id, what the user saw, and the first release that
   shipped the break (`git tag --contains <fix-sha>`).
2. Add the check to `scripts/smoke/post-install.mjs`. A check must not send a
   Coordinator message, call a model, or hit a paid API; seed state through the
   HTTP API or SQLite fixtures instead.
3. Prove it red on a build that has the old bug (`gh release download` the
   regressed release's zip, `--app`/`--prev-app` against it) and green on the
   build that carries the fix, then land.

## Seeding rules

- `CAIRN_HOME` is a scratch dir under `$TMPDIR`; the app is launched with
  `--user-data-dir=<scratch>` so it owns `<scratch>/home`.
- `tsnet-remote.json` must be written **before** the app boots — the server
  reads it once at startup.
- `machine.capabilities` needs a `devin` report (`{"installed":false,"models":[...]}`)
  plus an active `devin_subscription` (`enabledAt` non-null) for the Devin
  model source to appear on builds with `3ae0f5ce9`; on earlier builds only
  `installed:true` produces the source — that difference *is* the regression.
- Coordinator thread ids must start with `chief-`; seed messages straight into
  `chief_thread`/`chief_message` so no send path runs.
- `--prev-app <Cairn.app>` boots the previous release on the scratch home
  first, then `seedEveryTable` inserts a row into every table (foreign-key
  children included), so the new release's migrations run on populated data —
  this is what catches `DROP TABLE`-against-FK bugs like 0.1.536's.
