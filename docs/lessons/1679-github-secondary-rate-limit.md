---
Category: To check whether an App/username was taken, about 40 unauthenticated requests were fired at `github.com/<name>` and `github.com/apps/<name>` pages, tripping GitHub's per-egress-IP secondary rate limit; ian's account-signup page from the same IP was blocked (the authenticated API had 4994/5000 remaining — not an API quota problem)
Source: GitHub secondary rate limit (2026-10-25)
Level: 3
Safeguard: `docs/agent-dispatch-prompts.md` "Accessing GitHub": check names and status only with the authenticated `gh api`, one request per name, no page scraping, poll no more often than every 5 minutes; the dispatch prompt carries the same rule
Intercepts: 0
Recurrences: 0
Notes: Machines cannot intercept: requests may come from any script, curl, or browser automation, and in-repo scripts cannot uniformly block outbound requests; the negative control is this rate limit itself (ian's signup page returned Too many requests)
---
