------------------------- MODULE ReviewHeadCausality -------------------------
EXTENDS MergeGate

ReviewHeadWasObserved ==
  \A v \in verdictRows : v.recordedHead \in used

=============================================================================
