# Memory frontend

Status: B1 design draft, not owner-approved. [Real-component prototype and 52-state capture matrix](memory-prototype/README.md) exist; operated claude.ai reference evidence is still blocked. The registry frontend gap must not be closed on the strength of fixture screenshots alone. No product implementation is included.

## Brief

Surface: Coordinator settings, memory tab. User: the owner checking what the Coordinator will remember, removing a wrong fact, or deliberately expanding a project fact to the team. Success: distinguish stored memory from automatically injected memory, read the full fact and scope, and understand promotion/deletion.

Research: [B1 memory review](../research/memory-2026-11-08.md), [prior art](../research/personal-agent-memory-2026-11-07.md). Backend: [memory-backend](memory-backend.md). Reference: Claude Settings → Your Claude → Your memory → Manage → Topics, as documented by Claude. Exact one-to-one layout, computed styles and interaction recording are not claimed without signed-in operation.

Existing general settings references: [t3code General](references/settings/t3code-general.jpg), [t3code phone settings](references/settings/t3code-mobile-settings.png). These establish the repository's settings context, not the Claude memory surface. Do not substitute them for the requested memory reference.

Keep the existing Coordinator settings entry and tab navigation. No new route, top-level navigation, charts, colored identity tiles, memory score badges, account-memory switch or incognito mode. One list, not a grid of cards. Rules applied: P1–P5, C1/C5/C12, V1–V4/V6/V10/V20/V21, T2, A1–A4 and R1.

## Real components and replacement boundary

Compose the existing settings shell with `ListCard`/`ListRow`, `SettingsCard`, `Button`, `EmptyState`, `Skeleton`, `DialogShell` and `AlertDialogShell`. The prototype imports these real components and actual fonts/tokens directly; it does not draw lookalike controls. Its isolated content specimen intentionally omits the surrounding navigation and is labelled fictional, disconnected fixture data.

#3608 already removed `agentActor` gating and the obsolete select-an-agent message. Preserve that work. The separately dispatched implementation replaces silent pending/error rendering and adds memory detail/management controls in `apps/web/src/chief/chief-settings.tsx`. No product code is changed by this PR.

## Layout and copy

Keep the settings column's existing maximum width and 16px horizontal padding; current 56px header and token typography. Above one divided list, show active stored-entry count and capacity, not “memories in use”: not every stored entry is injected. Each row shows title, bounded content preview and neutral Team/project scope plus layer text. Log/searchable rows must not imply automatic injection.

Open a row to read full wrapping content in a dialog: title, body, scope/layer, updated time and available provenance. Raw database ids are not primary content. Promotion is a quiet action only for a valid project row; Delete opens confirmation. Inline Edit is not added without an HTTP edit contract; correction remains available through the Coordinator's tools.

Fixture facts: Verification commands (team core), Accessibility review (fictional Field Notes project core), Release handover (project searchable). No personal data or live identifiers.

## State and reference comparison

All fixture images below link to the matrix with 1440px/390px and light/dark captures. The reference column explicitly distinguishes documented behavior from blocked operation.

| State | Proposed behavior and actual fixture | Reference versus ours |
|---|---|---|
| Empty | One sentence plus explanation, no disabled Add button; `empty` | Claude empty shot blocked; our real EmptyState composition is a draft |
| Loading | Preserve shell, then three row-shaped Skeletons; no false zero count; `loading` | No observed Claude loading state; ours is explicitly seeded |
| Read error | Plain recovery sentence and Retry; no false empty list; `error` | No observed Claude error; ours supplies explicit recovery |
| Populated | Count plus one divided list; row opens full detail; `populated` | Claude Topics documented, exact operated reference blocked |
| Long detail | Wrapping full body, one scrolling dialog body; `long` | No observed Claude long-topic state; ours uses real DialogShell |
| Detail | Read-only body and scope, correction-by-chat explanation; `detail` | Claude also documents inline editing; ours deliberately does not invent an API |
| Promote confirmation | Full fact and project → Team consequence; `promote` | Cairn-specific scope expansion, not attributed to Claude |
| Promote pending/error | Disable affected controls with visible reason; failure preserves fact; `promote-pending`, `promote-error` | Cairn-specific fixtures; no external reference claim |
| Delete confirmation | Selected saved fact removed, not conversation or earlier versions; `delete` | Claude Delete documented; exact reference shot blocked |
| Delete pending/error | Keep row until success; failure retains content and actionable error; `delete-pending`, `delete-error` | No observed Claude failure state; ours is seeded |
| Success | Refetch authoritative list, close confirmation, focus next row/empty heading; local prototype updates only | API/query invalidation and focus after actual deletion remain implementation acceptance |
| Offline | Cached content with read-only explanation, no deliverable mutation control; `offline` | No observed Claude offline state; ours is a product-specific draft |

No hover/press shadow or lift, partial hover band or delayed hover. Hover fill covers the entire interactive row/control. Touch actions are visible without hover. Existing cached data on refresh failure stays visible with an inline error; this combined cached-error variant remains an implementation fixture to add, not a claim about the current server.

## Phone and accessibility

At 390px preserve row order and avoid horizontal scrolling. Detail/confirmation uses viewport-clamped shells with a single scrolling body. Stack actions as needed; interactive touch areas are at least 44px. The surrounding settings tabs use the existing Select fallback if labels do not fit, rather than shrinking/truncating labels.

Keyboard reaches tabs, rows, detail and confirmation controls in visual order. Escape closes the top layer and restores origin focus. Cancel receives safe initial confirmation focus. Refresh errors announce without stealing focus; mutation progress uses a live region.

The capture script measured zero WCAG A/AA/2.1/2.2 axe violations (including rendered contrast), no horizontal overflow in 52 fixtures, focus restoration after keyboard detail close and unchanged hover shadow/position with zero transition delay. These are fixture measurements, not live product acceptance or proof of every interaction rule. Long titles, actual query refetch, last-row deletion focus and complete-shell tab fallback remain implementation tests.

## Tests to write first for implementation

1. Preserve #3608's team-scoped availability with no retired-agent dependency.
2. Pending, failed, empty and populated reads are distinct; cached refresh error retains content.
3. Wrong-team and foreign scratchpad rows never appear.
4. Detail shows untruncated body/scope; promotion appears only for valid project entries.
5. Failed mutation preserves row; success refetches authoritative data without blind retry.
6. Keyboard focus returns after cancel, deletion and last-row deletion.
7. Full-shell states at 390/1440 in both themes; no overflow, hover/press shadow change or partial-band feedback.

## Acceptance blocker

This session exposes no signed-in browser/desktop-control tool; the conventional local CDP endpoint has no listener. Reference app operation, 60fps recording, computed styles and owner selection therefore remain unavailable. Do not inspect credential stores, sign in independently, invent reference screenshots or call this approved. The documentation PR can preserve these concrete drafts while keeping the frontend gap open; implementing the draft requires the owner's reference/selection step first.
