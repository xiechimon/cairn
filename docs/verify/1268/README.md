# #1268 — detail composer vs Claude Desktop (open-claude-ui)

Mon 2026-10-16: follow Claude Desktop / open-claude-ui handbook, not deepseek-harness.

## Decision table

| Item | #1268 dsh ask | Handbook / plan | Outcome |
|------|---------------|-----------------|--------|
| composer radius | 26px (`rounded-4xl`) | **20px** (`H1 §1.3.1`, `ChatComposer.tsx` `rounded-[20px]`, plan.md §4) | **kept CDS 20px** |
| composer shadow | `--card-lift` | **`--shadow-composer` ladder** (`docs/03` + `ChatComposer.tsx` inset hairline ring; plan.md §4 / T §5) | **restored shadow-composer** |
| send button | full circle (`rounded-full`) | **`size-8 rounded-lg` = 8px** (`ChatComposer.tsx` L250; concentric note plan.md §4) | **kept as `rounded-[8px]`** |
| bubble enter | dsh `card-enter` (4px / 150ms / ease-pop) | **`message-fade-up` spring** (`ChatMessageBubbles.tsx` `message-fade-up 0.4s`; plan.md §3 / motion `--spring-snappy`) | **kept as `anim-message-fade-up`** |
| superellipse | `.composer` / `.chat-bubble` | not in CDS; board-only dsh transplant in `app.css` | **removed** from composer/bubble |
| bubble radius | 18px | **18px** already on main | unchanged |
| colors | — | frozen | unchanged |

## Evidence

Fixture preview `:5273` scenario=16. See `before/` (dsh 26px PR state) vs `after/` (handbook-aligned).
