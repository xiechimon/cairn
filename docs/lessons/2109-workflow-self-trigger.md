---
Category: An unrequested trigger widening let a merged workflow edit run its own deployment on the next main push
Source: Issue #2109 fix round (2026-10-28)
Level: 2
Safeguard: `scripts/ci-job-structure-gate.test.mjs` case "site deployment limits uploads and retains main-only guarded triggers" pins `paths: ['site/**']` exactly, so the deployment workflow no longer triggers on its own path
Intercepts: 1
Recurrences: 0
Notes: Found by the independent review gate, not by the local gates. Negative control: the tightened assertion was red first on the round-1 workflow whose paths listed `.github/workflows/site-deploy.yml` (docs/verify/2109/review-red.log), green after restoring the site-only filter (docs/verify/2109/review-green.log). The ticket plan asked for the wider trigger, but the same plan required keeping the deployment guard; when a plan step widens what a protected workflow executes, resolve the conflict with the review gate before shipping, and keep workflow self-triggers out of auto-deploying pipelines: a manual `workflow_dispatch` by a maintainer is the narrower channel for workflow-only fixes
---
