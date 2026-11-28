# Restore the keep-awake tile

## User scenario

A new Mac user opens Cairn from the menu bar. Three always-visible radio rows replaced the large control in `efadf5557`; the computer header also shows the registration hostname. Restore the two-tile layout from [Native tray menu](native-tray-menu.md) with the three choices from [Keep-awake modes](keep-awake-modes.md). Owner approved on 11-28: 「做」. No setup, account, new storage or privilege. [Reference and alternatives](../research/tray-awake-button.md): reuse the Runner tile and follow the requested inline design rather than cycling or opening a side submenu.

## Scope

1. Below the Runner, show a round icon, “保持唤醒” / “Stay awake”, current effective mode, and a disclosure chevron. Click/VoiceOver press/Return/Right expands inline; arrows move across enabled choices; picking collapses without closing the menu. First Esc collapses and returns keyboard focus to the tile; second Esc closes the menu. Open collapsed without a focus ring. Retain “有任务运行时保持唤醒” as the accessible description even with the Runner stopped; no icon/tooltip or actual power-policy change.
2. New Mac surfaces replace the historical *hidden on battery* choice with the explicitly requested visible *disabled on battery* choice and inline translated “需要接通电源” / “Requires AC power”. Update the historical spec's current-presentation note, native living doc and battery regression assertion. AC-only eligibility, stored-mode restoration and non-Mac Electron menu stay unchanged.
3. Both headers use the Computers selector `machineDisplayName` in tray grouping. Move the selector to a pure module and keep the existing component export for callers. Preserve grouping, including distinct rows for identical display names. No new product registry key.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Cold open / no page | Live native skeleton; fallback tile disabled until host state | `apps/desktop/scripts/native-tray-action.test.ts`: “skeleton exposes a live keep-awake disclosure” | this change |
| Stopped Runner / no task | Subtitle is still the mode; help says while tasks run; icon and actual power remain unchanged | `apps/web/test/tray-native.test.ts`: “shows the localized effective mode with the Runner off” | this change |
| Native click and keyboard | Real click reveals inline choices; Right/Return reveal, Down navigates, Return picks, first Esc collapses, second closes | `apps/web/test/tray-native.test.ts` (model), `apps/desktop/scripts/tray-helper.test.mjs`: “keep-awake disclosure exposes current mode and inline children”; real AppKit regression case “native menu: keep-awake disclosure stays open through click and keyboard selection” in `apps/desktop/scripts/smoke-mac.mjs` probes the tracking path absent on the parent | this change |
| VoiceOver and pointer focus | AX disclosure button (not switch) exposes expanded state; disabled reason is spoken; pointer shows no keyboard focus ring | `apps/web/e2e/tray-awake.spec.ts` (accessibility), `apps/desktop/scripts/tray-helper.test.mjs`: “keep-awake disclosure exposes current mode and inline children” Swift AX assertions | this change |
| Click-away, other action, helper restart, Spaces switch | Tracking ends; next open starts collapsed | `apps/web/e2e/tray-awake.spec.ts` (blur), `apps/desktop/scripts/tray-helper.test.mjs`: same disclosure case's close/reopen assertions; Spaces switch also walked on Mac if available | this change |
| `/tray` Escape, focus and dismissal | Esc returns keyboard focus to the tile while open, then delegates to existing hide; blur clears expanded without moving focus | `apps/web/e2e/tray-awake.spec.ts`: “tray keep-awake discloses inline and returns focus without dismissing”; `apps/desktop/scripts/tray-popover.test.mjs` keeps the unchanged bounds contract | this change |
| Change mode or power while expanded | Update detail/mark/eligibility in place, don't reopen after a late refresh; disabled reason visible in zh/en; stored lid mode falls back to system then returns on AC | `apps/web/test/tray-native.test.ts`: rewrite old battery-hides-lid check as “battery disables lid-closed and checks the effective system fallback”; `apps/desktop/scripts/tray-helper.test.mjs`: same disclosure case's live refresh assertions | this change |
| Failed save / stale unavailable action | Collapse with last confirmed detail; no fake mark; reopen and retry same mode. An unavailable pick never dispatches | `apps/desktop/scripts/native-tray-action.test.ts`: “host rejects disabled disclosure children”; `apps/web/e2e/tray-awake.spec.ts`: “tray keeps the confirmed mode until the host publishes” | this change |
| Narrow/short viewport, long locale labels and item cap | Detail/row text use existing truncation; AppKit's standard scrolling and the web tray window's screen-fit scrolling keep Settings/Quit reachable | `apps/web/test/tray-native.test.ts`: “reserves bottom controls when the menu reaches its item cap”; narrow-height real smoke walk | this change |
| Mixed versions | New host accepts flat page rows, including absent battery lid row; old host sees identical flat/boolean payload | `apps/desktop/scripts/native-tray-action.test.ts`: “upgrades legacy page choices into one disclosure”; `apps/web/test/tray-native.test.ts`: old boolean compatibility assertion stays green, new flat projection assertion compares nested model and legacy output and goes red on the parent | this change |
| Non-Mac Electron menu | Existing flat radio list has no lid mode on Windows or Linux; does not consume the new schema | `apps/desktop/scripts/native-tray-action.test.ts`: unchanged non-Mac template guard alongside the new skeleton disclosure case | this change |
| Reported name, custom name, duplicate name, no name report | Both surfaces use the same selector, group key remains machine id | `apps/web/test/tray-native.test.ts`: “tray groups and native headers use the Computers display name”; `/tray` E2E also checks the rendered heading | this change |

## State and verification

Shared strict `disclosure` schema (`title`, `detail`, `enabled`, optional accessible help and exactly three keyed `choice` children with optional `tip`) and factory build the presentation on web and desktop. Web→desktop sends the existing flat legacy format because the desktop can load remote pages out of step; the new host normalizes it or fills missing copy from its locale, then sends the disclosure on its bundled helper channel. No change to the state/action signatures. Only the host writes mode; helper and web write transient expanded/focus state from the listed inputs, never from refreshed models. Swift prebuilds the children outside tracking; keep their visibility local, explicitly handle Return/Right/Esc during AppKit tracking, and preserve deferred rebuild for unrelated shape changes. If inline tracking cannot pass real clicks, rework before landing rather than silently ship a flyout.

V26/C45/C25/C34 from `design-rules-for.mjs`: system chrome, accessible toggle/disabled reason, stable detail row and no animation. Existing non-main surface; no page draft. Capture all mode states, stopped Runner, keyboard/pointer, light/dark, before/after and expand→pick→collapse on the mini (battery via Swift fixture snapshot, not a production override). Verify deployed SHA on mini and real menu-bar click on the owner's installed release.

## Out of scope

- No changes to persisted modes, power assertions, Electron-only non-Mac menu, side submenus or release scheduling.

## Review

- Verdict: PASS
- Plan-SHA256: 0aeb938084f5a2e156833dcfc3dc9029a935ab3f9ce9e6c34c56e5130197f9fe
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Reviewer: Pi plan review and finding-only fix-check
- Findings: Compatibility and edge coverage clarified; finding-only fix-check passed.
