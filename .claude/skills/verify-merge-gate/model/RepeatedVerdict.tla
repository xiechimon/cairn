-------------------------- MODULE RepeatedVerdict --------------------------
EXTENDS MergeGate

RepeatedVerdictNext ==
  CASE verdicts = 0 -> RecordVerdict("verify") /\ HasBlockAt("verify", "d1")'
    [] verdicts = 1 -> RecordVerdict("verify") /\ HasPassAt("verify", "d1")'
    [] verdicts = 2 -> RecordVerdict("review") /\ HasPassAt("review", "d1")'
    [] verdicts = 3 -> RecordVerdict("decision") /\ HasPassAt("decision", "d1")'
    [] OTHER -> Evaluate

RepeatedVerdictSpec == Init /\ [][RepeatedVerdictNext]_vars
RepeatedVerdictRemainsBlocked == ~lastEval.ready

=============================================================================
