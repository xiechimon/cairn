# Delivery failure modes

1. A stale branch changes one part of a file while main adds code elsewhere. The clean merge retains both changes and must pass.
2. A lane resolves an incoming merge by discarding upstream additions. The check must inspect the resulting tree and retain the earlier branch point for ownership attribution.
3. Unresolved conflicts or failed Git commands cannot establish a clean result.
4. An explicit reference to the affected PR permits the documented removal; a longer PR number is not the same reference.
5. Renames, duplicated line text and content beginning with dashes must retain the correct line ownership.
6. Commits outside the relevant base interval and unchanged upstream lines must not fail.
7. An overlap lookup failure must not be reported as an empty overlap list.
8. Planner, issue creation, PR opening and the duplicate-ask behavior need verification beyond routing a preselected same-ask identifier.

9. Adding the overlap rule to branch notes must preserve current task classification and stripping of historical notes.

The first seven scenarios have local Git or stubbed GitHub controls. The eighth remains incomplete. Worker branch instructions now carry the overlap rule, with 79 helper/protocol checks and a source-hashed runtime observation. The chief now has a callable body/file overlap read and matching user/wake claim instructions, backed by the same lookup as the CLI. The new checks use fixture GitHub responses and do not establish live-provider semantic behavior. The workflow, documentation, AGENTS changes and real-model duplicate-ask evaluation remain to be incorporated. No replacement PR is ready for acceptance.

10. The chief cannot execute the worker CLI, and its existing issue/PR list tools omit bodies and changed files. A prompt without a callable overlap surface cannot establish chief-side acceptance.
11. The overlap read must authorize the project against the current team before retrieving its token or sending requests. Missing connections, malformed inputs, failed or incomplete searches, malformed pages and later-page failures must propagate as errors rather than empty overlap lists.
12. The chief-side surface must search title/body terms, include every result page, include unrelated-title open PRs touching planned files (including previous filenames), retain their head branches, and mark third-party text as untrusted. The lookup itself must perform no issue, PR or comment writes.
13. Large third-party bodies can overflow the chief context. The read must reject an oversized page set or final report explicitly, never silently truncate candidate bodies and claim a complete lookup.
14. Raw GitHub metadata can make an otherwise small overlap report exceed its budget. Keep complete titles, bodies, item numbers and head branches, while projecting away unused API metadata rather than dropping candidates or truncating their bodies.
15. Serial file reads exceed the chief relay budget on the real Cairn repository. File lookup must use bounded parallelism, retain input order, and stop queued work after a failure; a faster partial report is not acceptance. The first real HTTP observation aborts after 18 requests at 8,362 ms.
