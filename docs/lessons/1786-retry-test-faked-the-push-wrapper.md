---
Category: A retry acceptance test implemented retries inside its fake workspace, so removing the production push wrapper still passed
Source: #1786 (2026-10-26)
Level: 2
Safeguard: The runner acceptance test uses the real WorkspaceManager.push with gitPrim.push failures; provider tests cover retryable=false, stream exceptions, actual timer delays, and fallback exhaustion
Intercepts: 2
Recurrences: 0
Notes: Negative controls: removing the production push wrapper fails with one attempt instead of three; removing the outage trigger fails with failed instead of pending; Connection error and fetch failed originally opened one session instead of five. A missing await while adapting the test was caught by the test run and corrected before final validation.
---
