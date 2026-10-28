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

The first seven scenarios have local Git or stubbed GitHub controls. The eighth remains incomplete. Worker branch instructions now carry the overlap rule, with 79 helper/protocol checks and a source-hashed runtime observation. Chief injection, the workflow, documentation and AGENTS changes remain to be incorporated. No replacement PR is ready for acceptance.
