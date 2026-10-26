# ADR 0027 · Independent review requires a different vendor

> Status: **Decided** (2026-10-26, ian, on #1774). Amends ADR 0026 R2. ADR 0026's body is unchanged, per the convention that ADRs are amended by new ADRs, not edited.

## Problem Statement

ADR 0026 R2 says a protected-path review counts only when the reviewer "runs on a different model than the one that wrote the patch". The merge gate compared the two model ids with `!==`. These pairs compared as different and satisfied the gate:

- a provider prefix: `anthropic/claude-opus-5-5` and `claude-opus-5-5`
- a variant suffix: `claude-opus-5-5[1m]` and `claude-opus-5-5`
- a relay route name and the upstream id it selects: `balanced` and `kimi-k3`, `cheap` and `deepseek-v4.1-flash`, `precise` and `gpt-5.6-sol`

The same model could review its own patch. Even a genuinely different model from the same lab is not the check R2 was for. Greptile's cross-model measurements and Comfy's four-lab review both show that models from one lab miss the same bug classes; same-lab agreement is not an independent review. On 2026-10-26 ian decided that R2 requires a different vendor, not only a different model id.

## Decision

The merge gate normalizes both model ids before comparing them, using the pi model roster (`@earendil-works/pi-ai` provider catalogs, including the radius relay roster and its `lab` field):

1. Trim, strip one trailing variant suffix (`[1m]`, `[1M]`, and the same shape), and take the last `/`-separated segment so a provider prefix does not create a second id.
2. Resolve a radius route name (`balanced`, `cheap`, `precise`) to the upstream id that shares its cost and context in that roster.
3. Map the canonical id to a vendor. Single-lab providers supply the vendor directly. Radius entries supply it through `lab` (`Moonshot AI` is Moonshot). An id that the roster assigns to two vendors, or to none, has no vendor.

`independent-review-missing` fires when the canonical ids are equal, when the vendors are equal, or when either vendor is unknown. The blocker names the shared vendor, or says which side is unknown. The gate does not fall back to a same-vendor review while a cross-vendor reviewer is missing; the PR waits.

Anything the previous string comparison blocked still blocks. Normalization and the vendor check only add blocks.

## Consequences

- A machine whose reviewers are all one vendor holds protected-path PRs until a reviewer from another known vendor is recorded. The blocker names the vendor that does not qualify.
- An id the roster does not know fails closed, including a new relay alias that has not been mapped. Updating the checked-in roster snapshot is part of taking that alias.
- The snapshot is derived from the installed pi catalogs. A catalog upgrade that changes vendors or route names fails the roster test until the snapshot is regenerated.

## Alternatives considered

- **Compare normalized model ids only, and allow two models from the same vendor.** This is R2 as originally written. Rejected by ian on 2026-10-26: same-lab review is not independent.
- **Treat an unknown id as its own vendor.** Rejected: an unmapped alias of the author's model would pass.
