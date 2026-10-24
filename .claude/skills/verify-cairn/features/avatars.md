# Avatars (local spiral seal, #387 → #1429)

Avatars = a spiral-seal data URL generated locally by `apps/web/src/lib/spiral-avatar.ts`, seeded from the displayName (project-color circle base + cream spiral, replacing dicebear since #1429) — same name, same image always, no storage needed, zero external requests. An agent that is working (streaming / thinking / typing row, chief button) passes `busy` and the spiral rotates inside the circle, static under `prefers-reduced-motion`. The avatar slot for an unbound chief is `chief/chief-spiral-face.tsx`. `avatarUrl` column semantics: null = locally generated (default); non-null = explicit override. When an override image fails to load, `img onError` falls back to a static asset (user=`/avatar-user.png`, agent=`/avatar-robot-1.svg`), CSS fixes the size so it does not break. The single-source component = `components/ui/seeded-avatar.tsx` (created at XMON-14, landing on the shadcn landing point `components/ui/avatar.tsx`; #1003 follows the #983 adjudication and **abandons the contents root** — the upstream after: pseudo-element hair ring needs a real containing block, and Root is a **fixed-size box**: the geometry lands on Root, consumers must explicitly pass `className="size-N"`, omitting it falls back to the registry default size-8 and gets cropped by the outer box (the documentation-side root cause of #1156 — this entry once sat on the old contents model); the img follows the registry part's size-full with Root).

## Sub-features

- `avatar-seed-user` the sidebar chip (rail + expanded) and the user-menu header are seeded by display name (USER_NAME fixture canon, consistent across live and fixture states).
- `avatar-seed-agent` team-page cards / board task-card executors / chip popover executor conversation rows are seeded by agent displayName; the live members projection (mapTeam) passes avatarUrl through, a non-null override takes effect.
- `avatar-create-preview` the create-Agent dialog avatar row previews live as the name is typed; an empty name falls back to the static asset.
- `avatar-fallback` override image unreachable -> onError one-shot swap to the static asset (bookkeeping by failed URL, retrying after a rename does not loop forever when the fallback itself fails).
- `avatar-busy` a working agent's spiral rotates, static at rest; the spiral geometry centers on the circle (e2e measures the bounding box).

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
- The fallback chain and the zero-third-party-request guarantee are pinned by fixture e2e (`apps/web/e2e/avatar-spiral.spec.ts`); the live probe does not duplicate them. `drive-avatars.mjs` asserts spiral data URLs and a dicebear request count of 0.
- In live mode the sidebar still renders the fixture-canon USER_NAME (existing chrome discipline, not this ticket's surface) — the seed follows the display name, do not match the sidebar against `/api/user/me`'s Owner.
- The rerun dialog's `未指派` row has no seed (the placeholder copy is not a person's name) and renders the static asset; the `seed` field of `displayFor` is the criterion, do not fall back to using `name` directly as the seed.
