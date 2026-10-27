---
Category: An e2e shard went red on a spec the branch never touched: the third identity save asserts a route-hit counter with a bare `toBe` immediately after `click()`, so a delayed PATCH interception fails it
Source: #1856 CI triage (2026-10-27)
Level: 3
Safeguard: Triage rule: reproduce suspected e2e flakes with `playwright test <spec> --repeat-each=<n> --workers=1` under load before attributing them to the branch, and attribute with `git diff origin/main..HEAD -- apps/web`
Intercepts: 1
Recurrences: 0
Notes: The racy shape is main-owned (`project-settings-identity.spec.ts`, unchanged since #1721): saves #1/#2 gate on the refetch response while save #3 has no gate; reproduced 1/150 locally while main's bracketing e2e shards were green; the retry-gate fix belongs to a web lane, and the timing race itself is not machine-checkable
---

