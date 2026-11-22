# Browser MCP: the owner's own Chrome behind `browser_*`

Issue #5394, option A. An owner who is signed in to a site in their own Chrome asks the
Coordinator to look at a page, and today gets Cairn's own Chromium: signed-out pages, a second
browser in the Dock, and a window raised over whatever they were doing. This change lets the
Coordinator work in the owner's Chrome instead, in background tabs of a tab group Browser MCP
creates for it, and keeps every other call on the browser Cairn already runs.

Where the owner meets it: Settings → Apps. A new preset, **Browser MCP**, with the Chrome
Web Store link for its extension and two setup steps. Turning it on adds no key, no account and
no OAuth; the extension is the only thing they install, and it stays in their browser. Nothing is
bundled with Cairn: the MCP server is `@browsermcp/mcp` from npm, started on their own Mac. When
they turn it off, or when the extension is missing, `browser_*` goes back to the browser Cairn
starts.

## States

| Connector `status` | Meaning | Who sets it |
| --- | --- | --- |
| `local` | enabled; the server is started on the owner's Mac, not called by the server | server, at creation |
| (removed) | off; `browser_*` drives Cairn's own browser | server, on delete |

The server never probes a local connector: it has no address it could reach. Whether the
extension is installed and paired is answered on the machine, by the first `browser_*` call, and
the answer travels to the owner through the tool result.

## Paths

1. **Enable.** Settings sends `POST /api/mcp/connectors` with `kind: catalog, catalogId:
   browsermcp`. The server stores `transport: stdio`, `status: local`, `url: null`; the launch
   spec (`npx -y @browsermcp/mcp@2.5.0`) lives in `MCP_CATALOG` in `@cairn/shared`, so the server
   never sends a command and the machine never runs one the server picked.
2. **An agent asks for a page.** `browser_navigate` / `browser_snapshot` / `browser_act` reach
   `machine-computer.ts`, which stamps `ownerChrome: 'browsermcp'` on the call when all of these
   hold: the tool is a browser tool, `stealth` is not set, the target machine is the server's own
   host (`machine.kind === 'local'` — server-assigned, not a self-reported capability like
   `computerKind`, which a Mac daemon always reports as `vm` and any remote daemon could claim),
   and the team has that connector enabled. Otherwise the call is unchanged.
   `kind === 'local'` is name-claimed co-location per spec 11: a `machineAccess` API key can mint
   it by enrolling with the server's hostname when the seeded local row is absent — bounded by the
   fact that the stamped call still runs Browser MCP only on that machine's own host (no privilege
   crosses machines; `user_computer_*` tools already trust the same gate). Tightening the enrol
   side is tracked separately.
3. **The machine drives the owner's Chrome.** The daemon starts the stdio MCP server for that
   session, calls its one tool (`browser`, one command per line) and answers with the same text
   shape as before: `[login form: …]`, `[page text]`, `[ref=@e12]`. Only a whitelisted subset of
   the command language is reachable — navigate/snapshot/click/fill/type/press/select/
   check/uncheck/scroll — never `eval`, `download`, `pdf`, `screenshot --path` or file uploads;
   every interpolated argument is quoted, and a `ref` must be a single snapshot token, so a
   model-produced argument cannot smuggle an extra command line. `browser_act` runs one action
   at a time: before a `fill`/`type` it reads the target's `type`/`autocomplete` and refuses
   password and one-time-code fields, and after every action it re-reads the page address, so a
   click that navigates onto Cairn stops the rest of the batch.
4. **Fallback.** No `npx`, no extension, server failed to start, or the connector was just turned
   off: the daemon runs the call on Cairn's own browser exactly as before, and says in the result
   that the owner's Chrome was not used and why.
5. **Pairing.** The extension asks the owner to click Allow, with a six-digit code, on the first
   call. That is a human step: the daemon returns the extension's own words (which code) to the
   agent, which repeats them to the owner, and does **not** open a second browser behind their
   back.

## What a local connector does not do

- It is not an HTTP endpoint: `stepConnectorEndpoints` and `connectorSlugs` skip it, so the agent
  never gets a second `browser` tool next to `browser_*`. One capability surface.
- It cannot take a token, headers, a URL or options; there is nothing for the owner to paste.
- `fill_secret` is refused on the owner's Chrome: Browser MCP logs the commands it runs, and a
  saved password must not reach a log file. Plain `fill`/`type` into a password or
  one-time-code field is refused for the same reason. The owner's Chrome already has their
  sessions; a site that still asks for a password goes through `request_takeover`.
- A failed call mid-`browser_act` does not replay the batch on Cairn's browser: a click that
  already ran must not run twice. Only "the MCP server never started" falls back.

## Failure modes and their tests

| Failure | Behaviour | Test |
| --- | --- | --- |
| Owner unchecks nothing, connector deleted mid-turn | next call runs on Cairn's browser | `mcp-servers.test.ts` local-connector cases + daemon fallback test |
| `npx` missing on the machine | fall back, name `npx` in the result | `owner-chrome.test.ts` |
| Extension installed, not paired | result is the extension's Allow message with its code; no fallback | `owner-chrome.test.ts` |
| Extension not installed | fall back, name the Web Store install | `owner-chrome.test.ts` |
| Site is Cairn itself | refused before anything is opened | `owner-chrome.test.ts` |
| Call arrives with `stealth: true` | never routed to the owner's Chrome | `machine-computer-forward.test.ts` |
| Target is a remote machine (a Mac daemon still reports `computerKind: vm`, and `computerKind` is self-reported) | never routed to the owner's Chrome — only the server's own host (`machine.kind === 'local'`) qualifies | `machine-computer-forward.test.ts` |
