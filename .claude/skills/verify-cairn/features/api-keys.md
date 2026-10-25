# API keys

Users generate access credentials at `/app/api-keys`: clicking `新建密钥` in the empty state yields a one-time plaintext key (`cairn_…`, shown only once) plus a masked row in the list; the key is used for machine registration (`cairn start --api-key …`) and MCP Bearer. The storage side persists only the keyHash, never the plaintext (02 §8 guardrail).

## Sub-features

- `keys-empty` fresh-DB empty state (icon tile + `尚无 API 密钥。` + create button).
- `keys-create` `.keys-create` opens the **permission-bit form dialog** (`api-key-create-dialog.tsx`, W4 #287): name (optional) + git/mcp switches + 49 tool read/write bits + select-all/clear shortcuts; clicking `.apikey-form-create` inside the dialog submits via `POST /api/teams/{id}/api-keys`.
- `keys-once` the one-time plaintext block `.keys-once-value` + `请立即复制密钥,它仅显示一次。`; gone on refresh.
- `keys-masked` list row `.keys-row` shows the mask (shape `cairn_afe07565…`).
- `keys-hash` the SQLite `api_key` table stores `keyHash`, the plaintext never enters the DB.

## How to get to it (user POV)

- Sidebar into the `API 密钥` page (`/app/api-keys`, secondary shell).
- Driving (`vp.mjs list api-keys` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive api-keys create`: click `新建密钥` in the empty state — one-time plaintext, masked row, only the hash in the DB; requires a fresh stack (the first drive after launch, otherwise it refuses to run).

## Driving it with verify-cairn

Preconditions:

- `launch.mjs` fresh DB (the create-key button exists **only in the empty state**; reusing a stack that already has a key shows no button — relaunch before re-verifying).
- `doctor.mjs` fully PASS.

- **Create a key.** Click `新建密钥` in the empty state. Run `node <skill>/scripts/drive.mjs api-key`. Chain: empty state ready -> click `.keys-create` -> the dialog `.apikey-form-create` settles -> click it to submit (form defaults) -> `.keys-once-value` appears with the `cairn_` prefix -> `.keys-row` >= 1 -> `GET /api/teams/<teamId>/api-keys` returns the masked row -> SQLite `SELECT id,name,masked,keyHash FROM api_key` has a row with a non-empty keyHash. Evidence `01-keys-empty.png` / `02-keys-create-dialog.png` / `03-keys-once.png` + `result.json` (apiKeyMasked/dbApiKey fields).
- **One-time semantics.** Manually after the probe: reload `/app/api-keys`, `.keys-once-value` is gone while the `.keys-row` mask remains.
- **Consuming the credential.** (beyond this map) the machine registration flow is in the README's uncovered-surfaces section.

## Gotchas

- Re-entering the page has no `新建` entry (the list state has no such button) — do not report "button missing" as a dead-button bug, it is empty-state-only.
- Key creation is **two steps**: clicking `.keys-create` only opens the dialog (before #287 it POSTed directly), you must click `.apikey-form-create` to submit; stopping after the first step stalls at the `.keys-once-value` timeout (drive.mjs once FAILed this way, see #344).
- The plaintext appears exactly once, in the create response: screenshot/assert in that response frame; every later view shows only the mask.
- Asserting "stores the hash, not the plaintext" means the DB's `keyHash` column is **not equal** to the plaintext, not merely that the column exists.
- teamId comes from `GET /api/teams[0].id` (single-user single-team is always one row).
