# Devin model catalog learned from the ACP adapter

Status: proposed 2026-11-17. Replaces the static `DEFAULT_DEVIN_MODELS` display list with the model catalog the managed `devin acp` process advertises on `session/new` (measured: a `configOptions` entry with `category === 'model'` and ~30 `options: [{value, name, _meta: {'cognition.ai/supportsImages'}}]`).

## State

One piece of state: the last model catalog a devin ACP session advertised on this machine.

| Location | Writer | Reader |
|---|---|---|
| `capabilities.devin.models` (optional `{id, name}[]` inside `devinReportSchema`, which stays `.strict()`) | `capabilitiesReport()` in `machine-loop.ts`, from an in-memory holder | Server: `parseReportedCapabilities` → `machine.capabilities` column → `listDevinSources` |
| `devin-models.json` in the daemon state home (`paths.devinModelsJson`, `{models: [{id, name}]}`, written via `writePrivateFile`) | `onDevinModels` callback, on every capture | `loadDevinModels` once at `runMachine` boot |

The catalog is account-level state, not per-session: one machine hosts one devin CLI login, and when a team binds several subscriptions the account a step runs under is chosen on the server. Last-seen wins — a later `session/new` response replaces the file and the report wholesale, never merges. Model ids pass through to `session/set_config_option` unfiltered; the daemon records exactly what the adapter advertised and never reorders or probes.

## Transitions

- absent → present: first devin step whose `session/new` (or `session/load` / `session/resume`, same `configOptions` field) response advertises a `category === 'model'` select option yields at least one usable `{value, name}` pair. Extraction flattens select groups, drops empty `value`s, falls back to `value` for an empty `name`, and dedupes by `value` first-wins.
- present → present: every later advertisement replaces the list and rewrites the file; concurrent devin steps write the same account's catalog, last write wins.
- never removed: no path deletes `devin-models.json` or clears `models`. When `devinManaged.current()` is null the whole `devin` report is `{installed: false}` and `models` is not attached, so an uninstalled devin never advertises a stale catalog.

## Readers and fallback chain

`listDevinSources` (`apps/server/src/services/providers.ts`): online machine with `capabilities.devin.installed === true` and a non-empty `devin.models` → the advertised list verbatim (each entry already matches `modelSourceModelSchema`; `slot` is left unset — `slot` is a free-form provenance tag that today only marks hardcoded `builtin` fallbacks and env-mapped claude-code slots, and an advertised account catalog is neither). Field absent or `[]` → `[...DEFAULT_DEVIN_MODELS]`, so old daemons keep showing the static three until their first devin step on the new daemon.

## Failure paths

- Daemon never ran a devin step: `devin-models.json` absent/corrupt → `loadDevinModels` yields nothing → `models` absent → static fallback.
- Runner restart: file reloads at boot; the next presence carries the persisted catalog; a later devin step refreshes it. Stale between steps is the intended bound.
- `configOptions` absent on the response: for `harness === 'devin'` the existing code already throws `ACP adapter did not advertise model configuration` — the step fails, no capture happens, the previous catalog stays.
- `options` empty or every entry filtered out: `onDevinModels` is not called; the previous catalog stays.
- Model option not `type: 'select'` (boolean toggle): no `options` to read → no capture.
- Persist write fails (disk full, permissions): the in-memory list still updates and is reported while the daemon runs; the failure is logged and the next capture retries the write.
- New daemon against a server older than this change: `devinReportSchema` is `.strict()`, so the old server drops the whole `devin` report (same one-directional caveat every additive field in this report has); the deploy wave makes it self-healing.
- Machine serving several subscriptions: whichever account the last devin step ran under wins; that is the honest account-level view since the catalog belongs to the logged-in CLI account, not to a subscription row.

## Tests

- `apps/daemon/test/devin-acp.test.ts`: a devin `session/new` response advertising model options calls `onDevinModels` with the extracted `{id, name}` list (groups flattened, duplicates removed); a non-devin harness never calls it; absent `configOptions` keeps the old failure and calls nothing.
- `apps/daemon/test/devin-acp.test.ts` machine-loop integration: a claimed devin step ends with `capabilities.devin.models` in the presence body and `devin-models.json` on disk; a boot seeded with the file reports `models` before any step ran.
- `apps/server/test/devin-claim.test.ts`: a machine whose capabilities carry `devin.models` yields a source listing exactly those models; `devin` without `models` yields `DEFAULT_DEVIN_MODELS`.
