---
Category: A pre-push run killed by a shell timeout left its `vite preview` on the heavy-slot port; the next pre-push reused that server through `reuseExistingServer` and ran the e2e suite against the old build, so three `machine-add-dialog` specs failed on text main had already changed
Source: #1698 (2026-10-25)
Level: 2
Safeguard: The heavy-slot Playwright config in `scripts/heavy-slots.mjs` sets `reuseExistingServer: false`: the slot lease already owns the port, so anything answering there is an orphan and the run stops with "already used"
Intercepts: 0
Recurrences: 0
Notes: Negative control: a stub server answering 200 on 8398 made `e2e:affected` run `shell-locale-default.spec.ts` against it and fail its assertions with the old config; with the fix the run refuses to start
---

