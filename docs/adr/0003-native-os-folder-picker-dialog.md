# ADR 0003 · Local folder selection = server opens the native OS dialog (v1 macOS only)

> Status: **Decided** (2026-09-29).
> Source: the UX problem that the "local folder" state in the new-project form only allows typing an absolute path by hand. This is the **second deliberate divergence from the todos.dev original site** (both the original site and spec 12 settled on "paste an absolute path" with no picker surface; the first divergence is ADR 0002).

## Problem Statement

The local state of the new-project form is a plain text input (`input[aria-label="本地文件夹"]` in `apps/web/src/pages/project-new-page.tsx`). On macOS, typing deep-directory absolute paths by hand (spaces, case, nesting) is painful and error-prone; you only find out when you hit a 400 reason code (`not_absolute` / `not_found` / `not_git`). The demand: clicking a browse button opens the **native OS** folder-picker dialog (folders only), and the selected path is backfilled.

## Recon facts (measured 2026-09-29, with sources for each)

| # | Fact | Source |
|---|---|---|
| F1 | The web app is a shell-less pure-browser SPA (vite); under the browser security model it **cannot obtain a local absolute path**: `showDirectoryPicker` only returns a FileSystemDirectoryHandle (basename, no path), `webkitdirectory` only gives relative paths; there is no such call anywhere in the repo | `apps/web/package.json`, repo-wide grep |
| F2 | localPath creation validation happens in the **server process fs**: `validateLocalRepoPath` three-state (isAbsolute / existsSync / isGitRepo) + `~` expanded against the server process HOME; the implementation is tightened for the **single-machine assumption**; the multi-machine "invisible = skip" degradation is a registered follow-up ticket that has not been done | `apps/server/src/services/git.ts:112-149`, spec 12 line 110/118 |
| F3 | localPath execution must be on the **daemon machine** fs (the claim delivers cloneUrl=localPath; the daemon clones locally + pushes the conv branch back to the user's repo — #1211: zero touching of the user's main checkout branch/worktree); the default deployment has server/daemon on the same machine (loopback), so the two "musts" coincide | `apps/server/src/services/machines.ts:807-822`, `apps/daemon/src/runner.ts:213-234,552-559` |
| F4 | The daemon has **no inbound surface**: it is a pure outbound HTTP client; server→daemon has only `{wake, sync, shutdown}` SSE events, no general RPC — "browse the executor machine's directories" lacks an architectural premise | `apps/daemon/src/machine-client.ts`, `routes-machine.ts:225-247` |
| F5 | The server already has a precedent of "read the local fs → project to the web": skills live-scan (readdir + realpath escape gate + capacity gate); there is no general `/api/fs` browse endpoint | `apps/server/src/services/skills.ts:69-116` |
| F6 | The server and the GitOps seam already have a convention of spawning local processes (isGitRepo = spawn git); the server default deployment is on the user's own machine (`npx @xiechimon/pacman` → 127.0.0.1:8787); the README also supports the split form "server on the browsing machine, daemon on the build machine" | `apps/server/src/lib/git.ts:201-214`, README.md:28-48 |

## Decision

| ID | Decision |
|---|---|
| **D1** | **The dialog is opened by the server process, not the browser** (F1 physical constraint): add a `POST /api/fs/pick` endpoint; the server spawns `osascript -e 'choose folder'` (the same panel as native macOS Finder, folders-only by nature), returns the absolute path over HTTP, and the web backfills the localPath input (the input remains the source of truth, still editable; backfill triggers the existing basename→project-name logic) |
| **D2** | **v1 machine semantics = the server machine**: the dialog shows the fs of the machine the server process runs on, same machine and semantics as the F2 creation validation (selectable = submittable). Browsing the executor machine (daemon machine) is **not done** — blocked doubly by F4's missing RPC seam and F2's multi-machine degradation follow-up; it is re-evaluated in the same wave as that follow-up |
| **D3** | **v1 is macOS only**: on non-macOS / headless / no GUI session → capability probe fails fast, take the degradation path; the endpoint internally leaves a per-platform dispatch seam (Linux zenity, Windows PowerShell, added on demand later) |
| **D4** | **Degradation semantics**: probe failure → one neutral line of hint next to the input (reusing the `.prj-new-error` line family position, wording at a non-error level: "This deployment shape does not support the system dialog; please type the path directly"); dialog cancel = silent no-op (input untouched, button re-enabled); the text input is always available |
| **D5** | **No browse-scope allowlist**: this is a single-tenant product, and the web surface is already a full-power control surface (dispatch builds, manage keys); the native dialog is inherently whole-disk visibility and adds no substantive new exposure. This decision also constrains the in-app browser follow-up (starting directory `$HOME`) |
| **D6** | **In-app directory browser = separate follow-up ticket** (the fallback for remote/headless shapes; out of scope for this ticket); the four content contracts already fixed travel with that ticket: list directories only; mark git repos per row (stat `.git`, **hint, do not hard-filter** — the git truth is still rev-parse, and parent-directory upward-walk semantics exist); dotfiles hidden by default + toggle; start at `$HOME`, remember last location (localStorage) |
| **D7** | **Single in-flight picker**: at most one pick in flight at any moment; repeated calls are rejected (409) or reuse the in-progress dialog — prevents dialog-stacking DoS and is the natural expression of single-user semantics |

## Premortem (assuming it already failed: the three most likely failure modes + guardrails)

| Failure mode | Guardrail |
|---|---|
| **osascript cannot open the dialog**: the server runs under a launchd/nohup/ssh session with no Aqua session; `choose folder` errors or opens in a session nobody is watching | Capability probe first (fail fast, seconds), degradation per D4 on failure; the probe must be tested in both "server started from a terminal vs started in the background" states (especially the dev-stack tsx watch form) |
| **Long-hanging HTTP gets cut**: osascript blocks until the dialog closes, so the request may hang for minutes; the dev-stack vite proxy's timeout behavior for long-hanging requests is unverified (same "dev/prod behavior divergence" pit family as strictPort) | Measure the proxy timeout as the first mine during construction; if it gets cut, switch to an async shape (return a pick id right after spawn; web polls/SSE for the result); the endpoint contract leaves room for this shape |
| **Backfilled path still hits 400**: a directory selected in the native dialog is not a git repo (the dialog does not check git), and submission gets `not_git` | Add no pre-validation — the existing reason-code error line is already translated down to "not a git repo" level; the D6 follow-up's git marking does at-selection hinting; this ticket accepts "selected a non-git directory → explicit error" as a qualified experience |

## Consequences

- **Positive**: the main shape (server = the user's Mac) gets a truly native dialog experience (favorites sidebar, ⌘⇧G, hidden-files toggle are all system-built-in); zero new UI family (one button + the existing input); the `/api/fs/pick` platform dispatch seam leaves room for future Linux/Windows GUI users.
- **Negative**: the remote/headless shape (server on a VPS) gets nothing from this ticket (stays on the plain-input status quo; only the D6 follow-up provides the fallback); platform divergence starts with this ticket (previously the web surface was platform-agnostic); the server gains the ability to "open a GUI on the host", whose trust model holds under single-tenancy and **must be re-reviewed if this ever becomes multi-tenant**.
- **Relationship to the original site**: the second deliberate divergence (after ADR 0002); spec 12's "paste absolute path" remains the fallback truth channel — what diverges is being the "only channel".
- **Reopen triggers**: the multi-machine validation degradation follow-up lands (executor-machine browse semantics becomes decidable, D2 re-evaluated); real users on Windows/Linux GUI deployments appear (D3 platform expansion); any Electron/Tauri shell decision (the F1 premise disappears and this ADR as a whole is voided and re-decided).
