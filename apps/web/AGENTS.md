# Cairn web

UI work follows `apps/web/DESIGN.md` (tokens, the which-component table, the process rules). Design rule rows live in the `## Rules` section of each `docs/design/surfaces/*.md`; before editing under `src/`, run `node scripts/design-rules-for.mjs <the paths you will touch>` from the repo root and keep the printed rows. Harnesses with the `design-cairn` skill invoke it first.
