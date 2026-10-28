---
Category: A prompt observation assumed the shared package was two directories above pnpm's filtered working directory
Source: PR #1848 repair of #1834 (2026-10-28)
Level: 1
Safeguard: The observation resolves the loaded shared package entry, derives the prompt source path from that entry, and verifies its location against the Git repository root before hashing it
Intercepts: 0
Recurrences: 0
Notes: The original realpathSync call fails with ENOENT in observer-depth-red.log. The corrected command produces worker-overlap-runtime.json with the actual source hash, task classification and English overlap suffix. Observation output is copied into the evidence directory only after JSON and hash validation. No model behavior is inferred from this helper observation.
---
