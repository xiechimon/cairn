# docs/spec

Specs that still govern current behavior. The numbering skips retired volumes; do not renumber, and do not treat a missing number as a file to recreate.

## Retired in this change, and where the live contract moved

| Removed | Why | Read instead |
|---|---|---|
| 00, 01, 02, `asset-replacement-plan.md` | Replication-era foundation. They describe cloning todos.dev and cite research notes as the contract | `packages/shared/src/protocol/` for REST, SSE and machine wire; `CONTEXT.md` for vocabulary; `apps/web/DESIGN.md` for UI |
| 03, 04, 05 | Replication build order and acceptance. Spec 06 already retired the replication obligation | `docs/spec/18-positioning-and-differentiation.md` |
| 25 | Never a spec. The feature map moved to `docs/feature-map.md` | `docs/feature-map.md` |

The remaining numbered specs (06, 08, 11 through 24, 26 through 30) and `base-ui-theme.md` stay. A later change removes the ones whose own text says they are superseded.
