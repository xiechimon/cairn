# docs/spec

Specs that still govern current behavior. The numbering skips retired volumes; do not renumber, and do not treat a missing number as a file to recreate.

## Retired in this change, and where the live contract moved

| Removed | Why | Read instead |
|---|---|---|
| 00, 01, 02, `asset-replacement-plan.md` | Replication-era foundation. They describe cloning todos.dev and cite research notes as the contract | `packages/shared/src/protocol/` for REST, SSE and machine wire; `CONTEXT.md` for vocabulary; `apps/web/DESIGN.md` for UI |
| 03, 04, 05 | Replication build order and acceptance. Spec 06 already retired the replication obligation | `docs/spec/18-positioning-and-differentiation.md` |
| 25 | Never a spec. The feature map moved to `docs/feature-map.md` | `docs/feature-map.md` |

The remaining numbered specs stay, but not all of them govern current behavior. Spec 21 says its mechanism was voided, spec 24 says its instructions are historical and must not be implemented, and spec 07 is an unevaluated draft. Read a spec's own status line before following it. A later change removes those three.
