# ADR 0017 · Dual execution sources: GitHub truth + localPath same-machine accelerator

> Status: **Decided** (2026-10-11; the #1173 grill settled it in five questions). Discussion ticket #1173, neighbor #1147 (machines-are-disposable map), preceding ADR 0016 (localPath degradation).

## Problem Statement

pacman's project model follows todos.dev: one project binds one repo, unchangeable after creation (no entry to re-bind). The 2026-10-10 topology verification hit it in practice: the pacman project of the local control plane is a localPath shape, and to verify "dispatch locally → execute on mea" (a remote machine can only run the githubRepo shape), the only path was creating a second project for the same repo — the same repo splits into two skins on the board.

The question is: at which layer should this pain be read? Is the opposite of "one project one repo, unchangeable" Multica's "a project is a container, repos are mountable resources", or the narrower "two access shapes of the same repo coexist"?

## Recon facts

| # | Fact | Source |
|---|---|---|
| F1 | The pain hit in practice is that **the same repo** needs both a local access path (localPath, used directly on the same machine) and a GitHub access path (githubRepo, cloned by remote machines) to coexist; "one project aggregating multiple different repos" has no evidenced demand in pacman's usage | #1173 ticket's hit-in-practice record |
| F2 | pacman's project page is itself a repo browser (file tree / commit history / file viewer), deeply coupled to the single-repo semantics; Multica **has no repo browsing surface at all** (none on any of the three platforms, a source-level negative proof); its "resource mounting" is a pure execution concept — the two products' project semantics are not isomorphic, and copying the resource model would additionally pay for multi-resourcing the browsing surface | codegraph consumer-surface scan + wiki "The species of Multica's repo surface" (main @ e0f84dd) |
| F3 | ADR 0016 has already characterized localPath as a single-machine cache shape — "githubRepo as truth, localPath as execution slot" naturally points the same way | ADR 0016 decision 3 |
| F4 | "local-shape truth + GitHub mirror slot" would require push-sync of local commits to GitHub (who pushes, when, how divergences converge) — an order of magnitude more complex, and the pain does not need it (the repo already has an origin) | grill Q3 reasoning |
| F5 | repoKind/localPath/githubRepo consumer surface: daemon workspace materialization (mirror clone), the github-issues surface, the github-probe PR probe, the web project page / creation flow / settings page, chief-tools | codegraph (the 10-call-site family of isGithubRepoRef) |

## Decision

1. **The real problem is pinned as "same repo, two sources"; the multi-repo resource model is not adopted** (F1/F2). "Project is a container, repos are resources" is an assumption borrowed from Multica's shape; pacman has no corresponding usage evidence, and its project-page browsing semantics are not isomorphic to Multica's.
2. **Dual execution sources**: a `repoKind=github` project may additionally mount an optional `localPath` (same-machine execution accelerator slot); githubRepo is permanently the truth source, and localPath is only a local read path on the execution surface. No resource table, no browsing-surface rework, no migration of existing rows (semantics unchanged; only the combination is unblocked).
3. **Truth flows one way** (F4): commits land on GitHub first, machines pull; the "local truth + GitHub mirror" direction is not opened (push sync waits for the day there is evidenced demand).
4. **Machine-side source selection by a two-condition check**: `localPath` exists and its `.git` remote/HEAD matches the project's `githubRepo` → go local (saving the clone); any mismatch → silently fall back to a GitHub clone, no error, no step stall. Guards against "different machines coincidentally sharing a path being wrongly absorbed".
5. **Minimal UI surface**: the project settings page gains one clearable optional field "local accelerator path" (shown only for the github shape); the creation flow, project page, and board are untouched; "which source a step took" does not enter the UI (see daemon logs for debugging).
6. If a "truly multi-repo" demand ever appears, growing dual execution sources into a resource table is the natural evolution (the execution-slot concept already exists), not a rollback — this ruling does not block the road.

## Premortem (assuming this ruling is wrong: the three most likely failure modes)

1. "Same repo, two sources" is judged too narrow; the real demand is multi-repo (e.g. one product spanning frontend and backend repos working jointly) → guardrail: decision 6 leaves the evolution path; when the real demand appears, reopen the discussion in the #1173 shape with usage evidence.
2. The two-condition check's "remote/HEAD matches" criterion is written too loosely, and a stale local path is read as the new truth (local behind remote) → guardrail: localPath is only a read path; the execution surface still goes through the daemon mirror clone + fetch to the remote tip before starting work (the existing #352 surface); the accelerator saves transfer, not freshness judgment.
3. Repurposing the localPath field causes semantic confusion (ADR 0016's "single-machine cache" label and 0017's "accelerator slot" being misread against each other) → guardrail: 0016 gains a pointer to this document; the CONTEXT.md "repo" entry is revised with the construction ticket.

## Relationship to ADR 0016

0016 ruled localPath degraded to a single-machine cache shape ("if the machine dies, progress goes with the machine"). 0017 does not overturn it: localPath remains a single-machine slot carrying no truth; 0017 only allows a github-shape project to additionally register this slot as an execution accelerator. The ownership of disposability is unchanged — truth and disposability belong to githubRepo only.
