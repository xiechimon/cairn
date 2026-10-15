# #1268 — detail page deepseek-harness alignment

## Change

- `--radius-composer` 20px → **26px** (dsh input-card neighbour)
- composer shadow → **`--card-lift`**
- send/stop button `rounded-[10px]` → **`rounded-full`**
- user bubble keeps `--radius-bubble` 18px; adds **`card-enter`** (150ms)
- `.composer` / `.chat-bubble` join superellipse(1.5) corner-shape family

## Conflict note

CDS tokens (#1355/#1361) had locked composer at 20px with `--shadow-composer`. This PR intentionally revises that lock per #1268 (mon: work all open issues; leave PR for review). Bubble 18px unchanged.

## Evidence

Fixture preview on `127.0.0.1:5273` (scenario=16). Server port 8791 was occupied by sand-egress; UI-only fixture suffices for radius/shadow/send geometry.

| Leg | composer radius | send radius class | bubble |
|-----|-----------------|-------------------|--------|
| before (`main`) | 20px | rounded-[10px] → 10px | 18px |
| after (this branch) | 26px | rounded-full | 18px + card-enter |

Screenshots: `before/`, `after/`. Also mirrored under `/workspace/morning-evidence/issues-1268/`.
