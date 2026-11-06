# 2026-11-06 api-evidence-card

D117: the pr-evidence gate requires an evidence card for `apps/server/src/routes*.ts` changes. Added the `api-evidence-card` feature (`features/api-evidence-card.md`, case `card`, script `scripts/api-evidence-card.mjs`) that writes the transcript, call screenshot and Requests table from a live stack. Removed the stale claim that the gate rejects screenshots outside `docs/verify/<issue>/` (#1983 check deleted in #2201).
