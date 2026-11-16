# Default owner name

Scope: the independent first-run default only. GitHub profile name/avatar synchronization belongs to the shared-App identity v2 change. The existing onboarding already asks only about models; it has no account-name field. Keep Edit name unchanged.

Use Node's cross-platform `os.userInfo().username` on the server when inserting the first owner. Trim the result; an empty value or an OS lookup error uses Owner. Do not infer the username from HOME, USER, USERNAME or a platform-specific path. Node documents that userInfo gets the effective user's OS identity on POSIX and Windows: [Node OS API](https://nodejs.org/api/os.html#osuserinfooptions). This is the service account on a remotely hosted instance, not the browser's local user.

| Path | Before | After / failure behavior | Regression |
| --- | --- | --- | --- |
| Fresh database | Always Owner | OS username, including Windows/POSIX names | Fresh session and stored name match mocked OS identity |
| OS lookup empty or throws | Owner | Owner, without failing startup | Both failure forms produce a usable session |
| Existing database / restart | Stored name | Replace exactly Owner with the OS username; preserve every other name and every avatar | Default Owner upgrades; a manual rename survives another seed and server restart |
| Account Edit name | Persist the supplied name | Unchanged | Existing rename/read-surface tests |
| Local squash metadata | Uses the owner's current display name | An unrenamed owner now contributes the OS username; no GitHub credential or identity-policy change | Existing local-merge tests retain the display-name contract |
| Coordinator greetings and task notices | Read the owner's stored display name | They show the new stored name, including in prompts and internal logs | Session/member read-surface regression verifies the shared stored value |
| Packaging and live verification | Assume a seeded Owner | Pack smoke compares the server's OS username; probes accept a nonempty name or locate the session name | Pack smoke and live account checks |
| Connect GitHub | No profile sync | Deferred to v2; track an explicit manual-name override there | Not claimed by this PR |

No schema migration or provenance marker is needed in this change. The owner explicitly approved replacing exactly Owner on startup; a manual rename to exactly Owner is therefore also replaced on the next startup. If OS lookup fails it remains Owner and a later startup can try again. v2 must not infer a manual override by comparing text to the current OS username, since usernames and machines can change. The new default uses the existing account header and sidebar; verify live account default and manual rename at 1440/390 in both themes. No CSS or component changes are intended.
