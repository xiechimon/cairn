# Avatars (tinted initial, #387 → #1429 → owner 2026-11-12)

Avatars = `SeededAvatar` (`apps/web/src/components/ui/seeded-avatar.tsx`). A person or an agent with no picture gets a round tint of one of six colours picked from the displayName (`apps/web/src/lib/avatar-tint.ts`) with the name's first letter on it, a plain colour dot at 12px (owner 2026-11-12, replacing the spiral seal of #1429) — same name, same colour always, no storage needed, zero external requests. The avatar has no busy state and never moves. A supplied `avatarUrl` replaces the disc; a picture that fails to load falls back to the disc, and the static asset shows only when there is no name. `avatarUrl` column semantics: null = locally generated (default); non-null = explicit override. When an override image fails to load, the avatar falls back to the tinted initial; the static asset (user=`/avatar-user.png`, agent=`/avatar-robot-1.svg`) shows only when there is no name. The single-source component = `components/ui/seeded-avatar.tsx` (created at XMON-14, landing on the shadcn landing point `components/ui/avatar.tsx`; #1003 follows the #983 adjudication and **abandons the contents root** — the upstream after: pseudo-element hair ring needs a real containing block, and Root is a **fixed-size box**: the geometry lands on Root, consumers must explicitly pass `className="size-N"`, omitting it falls back to the registry default size-8 and gets cropped by the outer box (the documentation-side root cause of #1156 — this entry once sat on the old contents model); the picture or the initial fills Root with size-full).

## Sub-features

- `avatar-seed-user` the sidebar chip (rail + expanded) and the user-menu header are seeded by display name (USER_NAME fixture canon, consistent across live and fixture states).
- `avatar-seed-agent` team-page cards / board task-card executors / chip popover executor conversation rows are seeded by agent displayName; the live members projection (mapTeam) passes avatarUrl through, a non-null override takes effect.
- `avatar-create-preview` the create-Agent dialog avatar row previews live as the name is typed; an empty name falls back to the static asset.
- `avatar-fallback` override image unreachable -> the tinted initial of the name (bookkeeping by failed URL, so a rename does not retry the dead picture); no name -> the static asset.
- `avatar-still` the avatar has no busy variant; a working agent is shown by the typing dots.

## How to get to it (user POV)

- The sidebar bottom avatar chip (expanded / collapsed states); clicking it = the user-menu header.
- Team page `/app/team`: the `创建 Agent` dialog avatar row + the grid cards.
- The executor avatar at the bottom-left of a board task card (a fresh card with no agent shows a UserCircle placeholder, not the avatar surface).
- Driving: this feature has no current case; all registered ones are judged stale and refuse to run without `--force` (the refusal prints the reason), `vp.mjs list avatars` lists the usage:
  - `vp.mjs drive avatars dicebear-avatars`: the selectors it reads are no longer in apps/web/src.

## Driving it with verify-cairn

Preconditions:

- `launch.mjs` stack up + `doctor.mjs` fully PASS (fresh DB: no agents, create one on the team page first).

- **Full chain.** Run `node <skill>/scripts/drive-avatars.mjs`. Chain: sidebar chip / user-menu src assertion (src = `spiralAvatarUrl('Xmon Dai')`) → create two differently named agents on the team page (one Chinese name + one English name; the dialog preview re-seeds live as you type) → the two grid cards get distinct srcs → the ground-truth trio (`GET /api/user/me` avatarUrl=null / members actor.avatarUrl=null / SQLite `agent` row avatarUrl IS NULL) + the interceptor-recorded dicebear outbound request count (must be 0). Evidence: 3 screenshots + `result.json`.

## Gotchas

- **The probe intercepts dicebear, it does not hit the real external network**: `page.route('**/api.dicebear.com/**')` returns a fixed SVG. The assertion targets are the src contract + the real server-side data; external reachability is not under test. After an onError src swap **the attribute value becomes the fallback** — without interception, network flakiness beats the src assertion into a false red.
- The fallback chain and the zero-third-party-request guarantee are pinned by fixture e2e (`apps/web/e2e/avatar-initial.spec.ts`, `apps/web/e2e/account-controls.spec.ts`); the live probe does not duplicate them. `drive-avatars.mjs` is stale: it still asserts the spiral data URLs of #1429 and imports the removed `spiral-avatar.ts`.
- In live mode the sidebar still renders the fixture-canon USER_NAME (existing chrome discipline, not this ticket's surface) — the seed follows the display name, do not match the sidebar against `/api/user/me`'s Owner.
- The rerun dialog's `未指派` row has no seed (the placeholder copy is not a person's name) and renders the static asset; the `seed` field of `displayFor` is the criterion, do not fall back to using `name` directly as the seed.
