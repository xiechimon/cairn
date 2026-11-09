# Host computer driver spike: no qualified choice

Date: 2026-11-09. Scope: segment 2 of issue #3437; no HostScreen implementation or dependency changes. Results are recorded in [the authoritative spec, §4.4](user-computer-model-2026-11-08.md#44-spikes-before-the-change-feasibility).

Evidence labels: **Observed** means read or run first-hand; **Derived** means inferred from those observations. Unavailable checks are not passes.

## Decision

**No driver selected.** Neither candidate completed the required background script. agent-desktop cannot capture individual native Wayland windows. Cua captured both windows, but withheld exact-window action handles for the Qt application. CDP and Mac desktop operation remain unverified. These are blockers, not permission to add foreground delivery, another driver, a seat plugin, or an alternate mode. The proposal in §4.1 is not a measured approval to implement Cua (Derived).

Segment 3 must wait for a qualifying rerun. Segment 1's first program PR also does not exist at the time of this spike: searches by issue #3436 and branch `pi/task-139` returned no PR. This branch therefore must not open its segment 2 PR yet (Observed). The unchanged original spec is already accessible in [the earlier research-only PR #3449](https://github.com/xiechimon/cairn/pull/3449); that is not segment 1's program PR.

## Primary-source comparison

| Source | Mechanism and observed behavior | Trade-off | Evidence |
| --- | --- | --- | --- |
| [Cua Driver 0.38.0](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.38.0), live `describe` schemas and MCP results | AT-SPI semantic clicks, exact-window screenshots, explicit background raw-key refusal; Qt tree returned `accessibility_window_identity_unproven` and no actionable handle | GTK and capture worked; Qt semantic action could not safely be dispatched | Observed |
| [agent-desktop 1.1.0](https://github.com/vercel-labs/agent-desktop/tree/v1.1.0), installed `skills get platform` and capture reference | Semantic AT-SPI actions; strict headless delivery; scoped raw keys refuse when target focus is unproven | GTK and Qt actions worked, but single-window Wayland capture returned `PLATFORM_NOT_SUPPORTED`; no CDP command is advertised | Observed |
| [Hyprland 0.56.2 dispatcher source](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/config/lua/bindings/LuaBindingsDispatchers.cpp) and live IPC | Per-launch `hl.dsp.exec_cmd` rules prevent initial fixture activation; event socket reports active-window changes; command socket provides cursor position | Focus transitions are event-observed; cursor positions are sampled, not a complete motion trace | Observed |

The architecture still fits background semantic actions plus exact-window capture and explicit refusal. A documented feature or a readable tree does not establish a successful action. No third candidate or compatibility layer was introduced (Derived).

## Equal-script method

Both drivers ran against the same two native Wayland fixture processes on the existing Hyprland 0.56.2 session:

- GTK 3: one `Increment` button; Qt Widgets 6.12.0: the same button. Each writes its click count to a private scratch file. The fixtures have distinct titles, no secrets, and no application-side shortcut actions.
- Launch each through `scripts/owned-process.mjs`, using per-launch `no_initial_focus` and floating rules. Both fixtures suppress activation on initial mapping but remain focusable during driver actions; there is no permanent no-focus rule to mask a focus-stealing action. No persistent desktop configuration was edited. Each fixture exits through its own stop file or a 180-second deadline.
- Start the invariant observer before either fixture opens. Subscribe to Hyprland's active-window event stream; sample active-window identity and cursor coordinates every 10 ms through its local command socket. Mark any change or monitor error as a violation and refuse subsequent driver calls. Do not restore focus or pointer to conceal an excursion.
- For each driver and toolkit: snapshot the exact fixture window, request three semantic clicks with a fresh snapshot for each, read the fixture's counter after each, request an exact-window PNG, then request background `F24` on that same window. Never request headed or foreground delivery. The otherwise inert key tests refusal, not a useful application shortcut.
- Read-only browser classification targets the already-running Chrome window. Cua's private MCP runtime has an explicit existing-profile grant. `get_browser_state` returned `browser_consent_required`; its suggested `browser_prepare` setup was not invoked. No tabs, cookies, profile files, security settings, or login state were changed or exported. A missing default-profile endpoint file is only a readiness observation, not proof that all Chrome CDP attachment is impossible.
- Use agent-desktop's installed CLI and Cua's checksum-verified Linux 0.38.0 binary, unpacked only into scratch. Cua runs as a private direct MCP child through the installed MCP SDK, with native Wayland enabled. No Cua service, compositor plugin, installation script, or dependency install is involved. This is an interactive-session spike, not proof of daemon-environment parity.

The observer covers fixture launch, both candidates, and cleanup in one interval. Native fixture counters independently verify effects that both drivers describe as unverified. Three successful clicks do not certify other controls or applications.

## Results and limits

The exact numeric matrix is in §4.4. Final shared interval: **10,993 ms**, **967 samples**, **0 active-window events**, **0 changed focus samples**, **0 changed pointer samples**, **0 observer errors**. Maximum sample gap: **21.65 ms** (Observed).

No movement was observed, but a pointer excursion between samples could be missed. This is not a proof that the pointer never moved. The user was not asked to stop working; continuous typing in another window was not independently instrumented. No candidate receives a complete invariant/acceptance pass (Derived).

Cua's Qt snapshot explicitly returned a readable `Increment` node but no action handle, with `degraded: true` and `accessibility_window_identity_unproven`. The script sent **zero** Qt clicks rather than inventing an index, choosing another window, or falling back to pixels. Its GTK capture and Qt capture each produced a **420 × 200** image of the correct synthetic fixture; both were visually inspected. No full-desktop or Chrome screenshot was taken (Observed).

Reported click-batch times include snapshots, actions, counter readback and a 350 ms settle after each delivered action. The failed Cua Qt batch ends after its first read. Capture timings are single calls, not percentiles or a benchmark of general driver speed.

### Mac availability

The first five-second, batch-mode SSH probe reached macOS and found Cua Driver **0.38.0** and its app bundle. Read-only `permissions status --json` reported **no running driver daemon** and permissions **unknown**. agent-desktop was not on the remote PATH or at the checked managed-tool location. A later SSH probe timed out at five seconds (Observed).

**Zero Mac desktop checks executed; zero Mac passes.** No remote driver was installed, started, granted permissions, or attached to Chrome. Mac focus/pointer invariance was not measured. SSH initially succeeding does not establish desktop availability.

## Evidence and checks

Private reproducibility artifacts remain under `~/.cache/codex-scratch/pi-140/`: `measure.py`, `driver-probe.mjs`, the GTK/Qt fixtures, `driver-results.json`, `invariance.json`, `cua-gtk.png`, `cua-qt.png`, live schemas, upstream sources, and SSH preflight results. Raw browser content was not retained. Earlier preflight runs are separated from the final result; they exposed dispatcher-syntax and response-field mismatches and are not counted as failed application actions. Scratch-only scripts are not a shipped runtime or a CI test suite.

Before running the spike, seven targeted Vitest acceptance tests were written. Six negative controls failed against an unconditional-pass implementation; all seven passed after the predicate rejected absent samples, focus events, pointer changes, observer errors, unavailable capabilities, and empty capability sets. Command:

```sh
pnpm exec vitest run --root "$HOME/.cache/codex-scratch/pi-140" --config "$HOME/.cache/codex-scratch/pi-140/vitest.config.mjs" --maxWorkers=4
```

Additional safeguards in the probe: exact native window identity, field names read from live responses, no semantic click without an observed handle, fresh capture output paths, and refusal to continue after an invariant violation. The first launch's obsolete dispatcher syntax failed before creating a window; the corrected launcher uses the installed Lua dispatcher API. Earlier runs with permanent focus guards were excluded; the final run leaves both fixtures focusable.

Public evidence is limited to synthetic fixture results and this aggregate report. Local artifacts are not publicly downloadable; CI and cloud review remain unavailable until the prerequisite program PR exists and this segment's PR can be opened.
