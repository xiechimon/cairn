---
Category: A committed retry verification script was missing from the verification registry
Source: PR #2042 probe-reach-gate CI failure (2026-10-28)
Level: 2
Safeguard: Existing vp-registry-gate reach validation and the registered chief-dispatch-recovery entry
Intercepts: 1
Recurrences: 0
Notes: The existing reach gate rejected drive-retry.mjs before registration. The canonical vp entry supplies its output directory through VERIFY_EVIDENCE_DIR and runs the actual local-provider proof; no gate or exception was changed.
---
