---
Category: To check whether App/user names were taken, about 40 unauthenticated page requests were fired at `github.com/<name>` and `github.com/apps/<name>`, tripping GitHub's per-egress-IP secondary rate limit; ian's account-registration pages from the same IP were blocked (the authenticated API quota was 4994/5000, so this was not the API quota)
Source: GitHub secondary rate limit (2026-10-25)
Level: 3
Safeguard: the "Accessing GitHub" section of `docs/agent-dispatch-prompts.md`: look up names and status only with the authenticated `gh api`, one request per name, never scrape pages, and poll no more often than every 5 minutes; the dispatch prompt carries the same rule
Intercepts: 0
Recurrences: 0
Notes: no machine check can block it: requests can come from any script, curl or browser automation, and in-repo scripts cannot uniformly intercept outbound traffic; the negative control is this rate limit itself (ian's registration page returned Too many requests)
---
