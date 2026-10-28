------------------------- MODULE ReviewHeadCausality -------------------------
EXTENDS MergeGate

ReviewHeadWasObserved ==
  head /= "h1" \/ (\A v \in verdictRows : v.recordedHead = "h1")

=============================================================================
