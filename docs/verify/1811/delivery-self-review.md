# Delivery self-review

Reviewed against main `05d0dd12e3e9eab720bfd7c4afeb097ed4c0615e`. The current source file hashes are recorded in `delivery-source-files.json`.
This is the author's standalone code review and simplification pass. It is not an independent model verdict.

What it does:
- Adds bounded merge and local-landing models, retained verdict rows, repeated-verdict and causal-head regressions, and source-mapped findings for #1811.

Good:
- Repeated verdicts retain earlier blocks and qualifying independent review identities. Duplicate identical rows collapse without dropping the write count. The original head, digest and write bounds remain unchanged.
- Review records name the current head, or a previous head after an evidence-only push preserves the patch. P1H now has a reachable older-head counterexample.
- The runner pins the external checker checksum, uses a private temporary directory, removes its own intermediates and keeps model errors distinct from expected invariant failures.

Bad:
- The original single-slot abstraction erased verdict history. Retained records and P5 correct it; the original failure remains archived.
- The unrestricted review identity admitted an unobserved future head. P6 rejected it. The corrected record choices remove that impossible state, and P1H's observed counterexample now starts with PushEvidence. Its property was not relaxed.
- A production GitOps race remains outside the atomic LandLocal action. A real temporary-repository reproduction establishes that boundary. Product repair is outside this exploratory issue; #2050 contains relevant in-flight ref-transaction work and has not been approved here.

Ugly:
- The issue acceptance comment restricts paths to the new skill and docs. The normal commit hook rejects the ignored skill without the original PR's supporting one-line gitignore entry. A real git-add negative control and its passing allowlisted counterpart are archived. This metadata exception needs an explicit owner decision before merge.
- No authentication, dispatch protocol, persisted schema, production merge policy or dependency change is included. The lessons baseline writer froze missing legacy counters while recording regression interceptions; counters were not edited by hand.

Tests:
- The current twelve-config run has five passing properties and seven expected invariant failures. P1, P2 and P6 each explore 64,329 distinct states; P5 explores nine. Historical outputs remain labeled as earlier model versions.
- The unchanged claiming model passes four checks at 685,236 states each.
- Both runtime probes execute real functions. The landing probe uses a temporary bare Git repository and does not exercise the server endpoint.
- Lint, workspace typecheck and spec collection passed. The runtime evidence scripts passed standalone Node-type-aware typechecks. The first published delivery head passed the canonical 29-check prepush entry point.
- The simplification pass keeps the public model operators and configuration structure. Retained rows replace parallel overwritten outcome and identity slots; no dependency or production abstraction is introduced.

Open questions:
- May the delivery include the one-line gitignore allowlist entry required for the normal commit hook, despite the issue comment's literal two-directory restriction?
