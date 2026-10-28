# Proof fetch runtime observation

Run from the repository root:

```sh
TMPDIR=/private/tmp fnm exec --using=24.14.0 pnpm --filter @cairn/integration exec tsx eval/git-push-proof/observe.mts
```

`proof-observation.json` records the actual output against clean product source `80d1e90f4c00f8fdae7e1d40a4120cbaaffcf349`. It includes the producer script hash and product file hashes. The observer uses temporary local Git repositories and synthetic identities; it does not contact a hosted provider.

The callback names the actual containing remote tip. The preexisting FETCH_HEAD sentinel, remote-tracking refs and persistent local configuration remain unchanged. No proof ref remains. The observed remote branch retains the containing tip.

The observer is included in the normal integration compiler, as recorded in `observer-compiler-coverage.txt`. The prior standalone TypeScript command required manually assembled config and typeRoots flags; those flags are not part of this replay command or the mandatory project typecheck.

The explicit-destination follow-up is recorded separately in `refspec-proof-observation.json`, including its current source hashes and the platform-independent observer hash. It ran against modified source before the follow-up commit; its checkoutHead is historical metadata, not a claim that the old commit contains the repair. The same actual-tip, unchanged shared-state and proof-ref cleanup assertions passed. Using the platform temporary-directory API removes the hardcoded macOS path; this observation ran on macOS and is not a Linux execution claim.
