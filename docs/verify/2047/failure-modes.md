# Contained-push failure modes

1. A remote merge already contains the attempted local commit, so a rejected push must count as delivered.
2. A divergent remote tip does not contain the attempted commit, so the original rejection must remain a failure.
3. A narrowed or missing fetch mapping leaves a stale tracking ref that incorrectly appears to contain the local commit.
4. The checked-out HEAD differs from the branch being pushed, so checking HEAD can certify unrelated work.
5. A pre-push hook changes local refs after Git has selected the attempted commit; the proof must remain tied to that attempt.
6. The push destination differs from the fetch destination, so observing the latter cannot prove delivery to the former.
7. Multiple push destinations cannot be certified using only one fetched destination.
8. The verification fetch fails, its ref is missing, or the ancestry command fails; none may count as successful delivery.
9. Pre-push hook and authentication failures retain their existing error types and credential fallback behavior.
10. Temporary proof refs survive in shared repository state or interfere with concurrent fetches.
11. Reusing an expanded URL applies rewrite rules twice, or an ambiguous raw URL list selects a different repository.
12. Existing successful branch pushes, tag pushes, network retries and credential scoping change behavior.

The original PR tests and additional real-Git controls are installed before changing the source. Test repositories use local temporary bare repositories and synthetic identities.

13. A source-only push refspec inherits a different destination from remote.origin.push. A containing requested branch can then certify a rejection from another branch, or a successful push can publish to the wrong branch. The API must bind both source and destination while preserving named-branch hook input. The new real-Git controls precede the source repair.
14. The runtime observer must create its fixture under the platform temporary directory so the published replay works on Linux as well as macOS.
