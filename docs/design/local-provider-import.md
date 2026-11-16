# Import providers already configured on this Mac

First-run step 1 offers the providers the owner already set up for Pi on this Mac, so they do not retype base URLs and keys. Desktop app only: the browser build cannot read local files and shows no import entry.

## Contract

The Electron main process reads `~/.pi/agent/models.json` and `~/.pi/agent/auth.json`, parses them with `piProviders` / `piProviderImports` from `@cairn/shared` (`local-providers.ts`), and exposes two calls on the existing `cairnDesktop` preload bridge, each answering only `fromOwnPage` like the update calls:

- `localProviders.scan()` returns metadata only: `{ source: 'pi', providerId, label, api, baseUrl, models: {id, name}[], state }`. It never returns key material. `state` is one of:
  - `ready`: a literal key, from the provider's `api_key` entry in `auth.json` first, else `apiKey` in `models.json`. Pi's `$$` and `$!` escapes resolve to `$` and `!`.
  - `needs-key`: the key references an environment variable (`$NAME`, `${NAME}`), is a `!command`, or is missing. The GUI process has no shell environment, and Cairn never runs commands from a config file. The owner adds it through the ordinary list below.
  - `needs-login`: an `oauth` entry (Claude Pro/Max, Codex, xAI and similar). Refresh tokens rotate, so a copy would log out either Pi or Cairn. The owner signs in through Cairn's own entries.
  - `unsupported`: an `api` outside `providerApiSchema`, a base URL that is not http(s), or no models listed.
  - `exists` (computed in the page): the team already has a provider with this `providerId`.

- `localProviders.read(providerIds)` re-reads the files and returns `{ ...metadata, apiKey }` for the requested `ready` rows only. Nothing is cached in the main process between calls.

Only `name`, `api`, `baseUrl`, `authHeader` and each model's `id`/`name` are copied; `modelOverrides`, costs and limits stay in Pi.

The page then calls the existing `POST /api/teams/:team/providers` once per row, exactly as when the owner types a key into the form. The server seals the key with the existing secret box; no new server route, column, migration or daemon message. The desktop server listens on loopback, so the key never leaves the Mac on this path.

## States and paths

- **Nothing ready** (no file, unreadable or invalid JSON, or no `ready` row): no import entry; the provider list looks as it does today.
- **Found → scanned:** the entry reads "Found N providers on this Mac" with Choose and Import all. Import all imports every `ready` row.
- **Choose:** a checklist; `ready` rows start checked, other states are shown unchecked and disabled with their reason.
- **Importing:** one request per row. Rows succeed or fail independently and nothing is rolled back: each provider is an independent record the owner can delete. A failed row (including a `409` from another tab) raises a toast naming it.
- **Done:** if at least one provider was created, step 1 is done and step 2 opens with the existing recommendation.
- **Files change between scan and read:** `read` returns only rows still `ready`; a toast says how many are no longer on this Mac.

## Model picker ("Change")

Groups by provider label instead of the generic runtime label; rows show the model name only. Groups whose models cannot serve the role go last, with the reason after the group name. A single usable group shows no header. There is no search box: the select keeps keyboard type-ahead, and grouping keeps a long list scannable.

## Checks

- Unit: the scanner maps a fixture `models.json`/`auth.json` pair to every `state`, including env-name, `!command`, OAuth, unknown `api` and malformed files; `scan()` output never contains a key (assert on the serialized result).
- e2e (CI): first run with a mocked `cairnDesktop.localProviders` shows the entry, Import all creates the `ready` rows through the providers route and opens step 2; Choose disables sign-in and already-added rows; the browser build shows no entry.
- Mac: run the desktop build against the real `~/.pi` and confirm with screenshots; use `/security-review` before pushing, since the change handles credentials.
