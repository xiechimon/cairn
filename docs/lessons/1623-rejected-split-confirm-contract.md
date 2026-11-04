---
Category: Pure checker tests passed while structurally invalid split payloads threw before persisting the required confirm plan and reason
Source: PR #1654 canonical review (2026-10-28)
Level: 1
Safeguard: Structurally rejected auto and shadow proposals persist only parent build and plan records with a stable rejection marker; shared execution guards reject confirmation and ordinary build starts; correction is restricted to the current childless proposal with no execution records
Intercepts: 0
Recurrences: 0
Notes: Six real chief-tool cases originally threw and left no plan or transcript. New server negative controls also showed HTTP and chief confirmation, ordinary starts and generic revision could execute an unguarded rejected proposal. The repaired lifecycle passes these controls, retains rejected history on correction, and keeps human validation unchanged. Fractional numeric dependency indexes reach the semantic checker only in auto and shadow; nonnumeric, blank-title and single-child payload controls remain 400 before proposal persistence. A live-server browser case was red on the original 404 and green after rejection, blocked confirmation and corrected resubmission.
---
