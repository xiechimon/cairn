# Work trace baseline control

The first work-trace browser case from PR #1828 was copied, unchanged, into a separate checkout without the work-trace implementation. The temporary spec was removed after the run.

The baseline was the local #1906 reconciliation with main `101877c8d`. Its task UI did not contain the work-trace changes. The case expected two `work-summary` elements and observed zero. This is a negative control for the new work-group presentation, not a measurement of provider execution.

The candidate's corresponding focused browser run passed all 15 cases and its runtime tests passed 25 cases. Those logs and a current fixture screenshot are archived separately in `../cairn-1828-current-evidence/`.
