# Devin subscription model catalog

Status: proposed 2026-11-18. Gives a Devin subscription the same "models" semantics a custom provider has: `models` is the set of models the user **picked** from the upstream catalog, persisted on the subscription row. There is no full import: the catalog is harvested live per request, shown in a picker, and only the checked subset is written back.

Relation to `docs/design/devin-models-from-acp.md`: that doc covers the *machine layer* — a Runner's managed `devin acp` advertises the catalog of its logged-in CLI account and the daemon reports it through `capabilities.devin.models`. This doc covers the *subscription layer* — the server harvests the catalog itself by spawning the CLI with the stored token. The two layers agree because both read the same ACP `configOptions` contract; they disagree when the server and the machine run different CLI versions or accounts, so the model-source list is a union (see Readers), never a vote.

## State

| Location | Writer | Reader |
|---|---|---|
| `devin_subscription.models` (`models` JSON column, `DevinSubscriptionModel[]`, default `[]`) | `PATCH /api/teams/:id/devin-subscriptions/:cid` (owner session) — full-array replace | `listDevinSubscriptions` (wire), `listDevinSources` (enabled + unexpired subscription only) |
| `capabilities.devin.models` per machine | daemon, on each devin step's ACP session | `listDevinSources` |
| `DEFAULT_DEVIN_MODELS` | static code | `listDevinSources` fallback |

`DevinSubscriptionModel = {id, name, family?, costTier?, costSummary?, contextTokens?, supportsImages?, isNew?, isBeta?, liveness?}`; `liveness` reuses the `modelSourceModelSchema` enum and is unpopulated today — it exists so a later liveness pass does not need another migration. `id` is the upstream `model_uid` / ACP `value`, the exact string a `session/set_config_option` call takes.

## Write path — why fetch does not persist

Two endpoints, one direction:

- `POST .../upstream-models` runs the harvest and returns it in the `UpstreamModelsResult` envelope shape (`{status:'ok',models:[...]} | {status:'failed',failure,httpStatus}`). Items carry the full `DevinSubscriptionModel` entries — a superset of the `{id,name}` the generic `UpstreamModelPicker` needs, so the picker works unchanged and the same array can be passed back verbatim on save. Nothing is written: a transient upstream state must not silently rewrite a user's selection, and the picker owns the "which of these stay checked" decision.
- `PATCH .../devin-subscriptions/:cid` accepts `{label?, models?}` (at least one required). `models` is a full-array replace — entries absent from the array are deleted, matching `provider.models` PATCH semantics. The server validates each entry against `devinSubscriptionModelSchema`, dedupes by `id` first-wins, and caps the array at 2000 entries. `label` keeps the token-not-in-label check.

## Harvest — `fetchDevinSubscriptionModels(token)`

Spawns the real CLI twice under a scratch `$HOME` (mkdtemp, removed in `finally`), reusing the verification module's plumbing (`childEnv`, `devinBin`, `collectLines`, `errorReason`):

1. Write `$HOME/.local/share/devin/credentials.toml` mode `0600` with `windsurf_api_key = "<token>"`. Required because `devin models list` ignores `WINDSURF_API_KEY` and reads the toml (measured). The token's allowed charset needs no TOML escaping.
2. `devin models list --format json --process-model in-process` → `{families:[{family_label,family_uid,variants:[{model_uid,label,description,max_context_tokens,max_output_tokens,cost_tier,cost_summary,is_new,is_beta}]}]}` → a `model_uid → metadata` map (measured: 53 families / 1293 variants). Failure (spawn error, non-zero exit, unparseable output) degrades to an empty map — this command is enrichment, never the contract.
3. `devin acp` JSON-RPC: `initialize` with `clientCapabilities {session:{}, fs:{readTextFile:false,writeTextFile:false}}` (measured: omitting `session` is an internal error), `authenticate` when `authMethods` advertises one, then `session/new {cwd,mcpServers:[]}`. Collect `category === 'model'` `type === 'select'` options from the result **and** from `session/update` `config_option_update` notifications arriving within a ~2s settle window (measured: session/new alone can carry a partial list; the update carries the full one). Union deduped by `value` first-wins, select groups flattened — the ACP contract, not the models command, is the selectable set.
4. Output: one `DevinSubscriptionModel` per ACP value, in ACP order. `name` is the option label (falls back to `value`), `supportsImages` from `_meta['cognition.ai/supportsImages']`; `family`/`costTier`/`costSummary`/`contextTokens`/`isNew`/`isBeta` join from the catalog map when present (measured: all ACP values join).

## Failure paths

- No devin binary on the server (or `DEVIN_BIN` unset and no managed install): both spawns fail `ENOENT` → `{ok:false,reason:'unavailable'}` → envelope `{status:'failed',failure:'upstream',httpStatus:null}`. The `providerFailureSchema` enum has no member for "the server cannot run the CLI"; `unavailable` collapses onto `upstream` (decided: extending the shared enum would break exhaustive `Record<ProviderFailure,…>` maps in web). `auth→'auth'`, `timeout→'timeout'`, `unavailable→'upstream'`, `failed→'upstream'`.
- `devin models list` fails while ACP succeeds: entries ship without catalog metadata — the picker still gets the honest selectable set.
- ACP probe fails: the whole harvest fails with the probe's reason — the ACP advertised set is the authoritative contract; a `models list`-only fallback would offer values the session cannot actually select.
- Expired subscription: short-circuits to `{status:'failed',failure:'auth',httpStatus:null}` without spawning.
- Harvest is throttled like verification: one run per connection per 10s (429 after), so the picker retry button cannot stampede child processes.
- Token hygiene: the token only ever enters the scratch `credentials.toml` and the child env; the scratch HOME is removed in `finally`, and errors map through `errorReason` so stderr text never becomes a response body.

## Readers — `listDevinSources` three-layer merge

`models` on each devin source = `enabled subscription's stored selection (projected {id,name}) ∪ all online machines' capabilities.devin.models`, deduped by `id` first-wins; when both layers are empty the source keeps `[...DEFAULT_DEVIN_MODELS]` so un-migrated setups see the static three. The enabled-subscription gate is `activeSubscriptionRow` (enabled + unexpired): an expired account's picks stop being offered the moment its token is undeliverable. Every online devin source lists the same merged set — the selectable contract is account-level, not per-runner.

## Tests, one per path

- Harvest: real-shape fixture (models JSON + ACP transcript) → joined entries with metadata and `supportsImages`; `session/update`-only options merge; `models list` failure degrades to metadata-less entries; ACP failure/times out → `{ok:false,reason}`; missing binary → `unavailable`; `credentials.toml` exists at `0600` inside the scratch HOME.
- PATCH: dedupe by id first-wins; full replace; `{models}` alone keeps the label; `{}` → 400; >2000 → 400; malformed entry → 400.
- List: wire carries `models`.
- `listDevinSources`: subscription-only, machine-only, union dedupe order, all-empty → `DEFAULT_DEVIN_MODELS`, disabled/expired subscription contributes nothing.
- Endpoint: `ok` envelope, `unavailable`/`auth` mappings, 404 foreign, owner-only.
