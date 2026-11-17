# Step git key scope and lifetime

Hosted-repo steps authenticate their Runner's `git` with a per-step API key named `git-step-<stepId>` (`issueStepGitCredential`). GitHub-repo steps use GitHub App or user tokens and never touch this key.

## Defects fixed

1. The key opened every hosted repo of the team and any ref. A step could push `main` of any hosted project.
2. Every `GET /api/machine/token/:stepId` revoked and re-created the key. A second reader of the machine token (for example an unconfined agent session) invalidated the Runner's key mid-step.

## Design

Lifetime states: `none` (step not claimed) -> `valid` (step claimed) -> `revoked` (step leaves `claimed` or is deleted).

- Issue: only `stepToken` for a claimed step on a hosted project. The plaintext is derived, not random: `cairn_` + first 48 hex of HMAC-SHA256(server keyfile, `step-git-key-v1 | stepId | claimedAt`). The row is inserted only if the existing row's hash differs, so a repeat call returns the same credential and never invalidates the holder. A new claim has a new `claimedAt`, hence a new key.
- Read/verify: `verifyGitBasicAuth` matches the hash, then `gitKeyUsable` requires the step to be `claimed`.
- Revoke: SQLite triggers `step_git_key_revoke_on_release` and `step_git_key_revoke_on_delete` (migration 0180) delete the row when the step leaves `claimed` or is deleted. `gitKeyUsable` also refuses a key whose step is not claimed.

Scope, enforced in `routes-git-hosting.ts` for every request carrying a step key:

- Repo: the key's project (step -> build -> todo -> project) must equal the requested hosted repo, else 404. Personal spaces additionally refuse non-step keys, as before.
- Refs on `git-receive-pack` (non-personal-space repos): every command in the pkt-line preamble must be `refs/heads/<conversationBranch(buildId)>` (create or update, not delete) or the creation of a `refs/tags/*` tag (the Runner's tag tool). Anything else, a compressed body, or an unparsable body is refused with 403 before git runs. Reads (`upload-pack`) are allowed on the key's own repo.
- Personal spaces keep their own server-side hardening (hidden default branch refs).

Failure behaviour: a refused push returns 403 with the allowed branch named; a wrong repo looks like a missing repo (404); a stopped step returns 401 as before.

## Paths

| Path | Behaviour |
| --- | --- |
| Runner token call, first | creates key |
| Runner or any second token call while claimed | same credential, row untouched |
| Step done / stopped / released / abandoned / deleted | trigger deletes key |
| Re-claim of a released step | new `claimedAt`, new key |
| GitHub-repo step | no step key |
