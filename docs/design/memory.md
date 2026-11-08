# Memory frontend

Status: B1 draft, not approved and not frontend-complete. Reference operation and the real-component state screenshot matrix remain required before the registry gap can be closed. No product implementation is included.

## Brief

User: the owner checking what the Coordinator will remember, removing a wrong fact, or deliberately expanding a project fact to the team. Success: the owner can distinguish stored memory from automatically injected memory, read the full fact and scope, and understand the consequence of promotion/deletion.

Research: [B1 memory review](../research/memory-2026-11-08.md), [prior art](../research/personal-agent-memory-2026-11-07.md). Backend contract: [memory-backend](memory-backend.md). Reference: Claude Settings → Your Claude → Your memory → Manage → Topics, as documented by Claude; actual signed-in operation is pending. Do not call this a one-to-one measured reproduction yet.

Keep the existing Coordinator settings entry and memory tab. No new route or top-level navigation. No charts, colored identity tiles, memory score badges or new settings modes. The page is a list, not a grid of cards. Rules checked in the written design: P1–P5, C1/C5/C12, V1–V4/V6/V10/V20/V21, T2, A1–A4 and R1. Rendered contrast/keyboard/axe verification remains pending.

## Real-component inventory

Use `ChiefSettings`' existing header and `SegmentedTabs`; compose `SettingsCard` with `SettingsRow`/`SETTINGS_ROW_CLS`, `Button`, existing `EmptyState`, registry `Skeleton`, existing query-state error presentation, `DialogShell` for reading, and the project's alert-dialog confirmation shell. These are the real gallery/system components, not SVG/HTML drawings of controls. Discover their actual props before writing a prototype. Do not add a second local version of any component.

The old memory branch in `apps/web/src/chief/chief-settings.tsx` is replaced in separately dispatched implementation: remove `agentActor` gating, the obsolete select-an-agent message, and silent null rendering during reads. The server owns memory scope and validity.

## Layout and content

Keep the settings column at its existing maximum width, with 16px horizontal body padding. Use the current 56px settings header and token typography. Above one divided card, show stored active-entry count and capacity, not “memories in use”: not every stored row is injected. Each row has the full topic title, a short content preview, and a neutral Team or project-name scope label. Show layer as secondary text when needed; do not imply that log/searchable rows are automatically injected.

A row opens a read-only detail dialog: title, full wrapping body, scope/layer, updated time and available provenance. No raw database ids as primary content. Promotion is a quiet action only for a valid project row; Delete opens confirmation. Do not add inline Edit without an API design. Correction through the Coordinator is explained in plain copy rather than a nonfunctional button.

Example fixture facts: “Verification commands” with “Run the affected tests before pushing a code change” (team core); “Accessibility review” with “Check keyboard navigation before requesting review” (project core). Use fictional projects and no personal data or live identifiers.

## State matrix

Every row below requires desktop 1440px and phone 390px screenshots in light and dark, using real components on the fixture stack.

| State | Appearance and behavior | Reference versus ours |
|---|---|---|
| Empty | One sentence: no saved memories yet; explain that useful facts are saved during work. No disabled Add button | Claude empty reference pending; Cairn fixture pending |
| Loading | Preserve header/tab; after the existing loading threshold show three row-shaped Skeletons, no false zero count | Reference pending; fixture pending |
| Read error | One plain sentence and Retry; never replace failed reads with empty. Existing cached rows remain with an inline refresh error | Reference pending; fixture pending |
| Populated | One divided list, count, title, preview, scope; row opens full detail | Claude documented Topics model; operated reference and fixture pending |
| Long fact/title | Wrap title/body in detail; preview stays bounded; actions never squeeze content into a narrow band | Both pending |
| Promotion confirmation | Full fact and project → Team destination; explain wider future visibility; confirm or cancel | Cairn-specific scope extension; real dialog fixture pending |
| Promotion pending/error | Disable only the affected action with a reason; retain fact on failure; retry is deliberate | Cairn-specific; fixture pending |
| Delete confirmation | State that the selected saved fact is removed, not its source conversation/history; cancel receives safe initial focus | Documented Claude delete action; exact reference and fixture pending |
| Delete pending/error | Keep row until 204; failure retains it and dialog text explains recovery | Both pending |
| Success | Invalidate/refetch list; close confirmation and return focus to next surviving row, or empty-state heading | Both pending |
| Offline | Preserve cached content with read-only explanation; do not offer a mutation that cannot be delivered | Both pending |

No hover/press shadow, lift, pointer movement or delayed hover feedback. Any hover background covers the complete interactive row/control, never a partial band. Touch actions remain visible; no hover-only control is required to manage a fact.

## Phone and accessibility

At 390px use the same list order, no horizontal scrolling, no fixed-width fact body. The detail/confirmation dialog uses the existing viewport-clamped shell and one scrolling body. Stack actions if necessary; touch hit areas are at least 44px. If the settings tabs do not fit, use the existing Select pattern rather than shrinking/truncating labels.

Tab reaches tabs, rows, detail controls and confirmation actions in visual order. Escape closes the topmost layer and restores focus. A refresh error is announced without stealing focus. Mutation progress and success use the existing live-region pattern. Measure WCAG AA contrast in both themes and axe violations; token selection alone does not prove rendered compliance.

## Tests to write first

1. Team memory loads when the retired agent actor is absent; no select-agent dead end.
2. Pending read, failed read, empty response and populated response are four distinct states.
3. Wrong-team rows never appear; scratchpads are not exposed by settings.
4. Row detail shows untruncated body and scope; promotion appears only for valid project entries.
5. Failed promotion/delete preserves the row and actionable error; success refetches authoritative data.
6. Keyboard focus returns correctly after cancel, deletion and last-row deletion.
7. Four-state plus mutation screenshot matrix at 390/1440 in both themes; no overflow, no shadow change, full-row immediate hover.

## Acceptance blockers

No signed-in claude.ai/Linear/t3code app session is exposed in this execution environment. The official article was readable, but that does not satisfy operated-reference, 60fps recording or computed-style evidence. Local Chromium and Playwright are present; the required prototype matrix has not been produced. Owner selection has not happened. Keep the registry frontend gap open until these artifacts exist; do not substitute hand-drawn screenshots or present this document as an approved design.
