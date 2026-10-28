----------------------------- MODULE LocalLanding -----------------------------
EXTENDS Naturals

CONSTANTS RecheckPatch, RecheckBase, FfCheck

VARIABLES base, patch, judged, decided, commitReady, commitBase,
          landed, patchChanges, baseMoves

Bases   == {"b1", "b2"}
Digests == {"d1", "d2"}
Fact     == [b : Bases, d : Digests]
NoFact   == [b |-> "none", d |-> "none"]
FactVal  == Fact \cup {NoFact}

vars == <<base, patch, judged, decided, commitReady, commitBase,
          landed, patchChanges, baseMoves>>

TypeOK ==
  /\ base \in Bases
  /\ patch \in Digests
  /\ judged \in FactVal
  /\ decided \in FactVal
  /\ commitReady \in BOOLEAN
  /\ commitBase \in Bases \cup {"none"}
  /\ landed \in FactVal
  /\ patchChanges \in 0..1
  /\ baseMoves \in 0..1

Init ==
  /\ base = "b1" /\ patch = "d1"
  /\ judged = NoFact /\ decided = NoFact
  /\ commitReady = FALSE /\ commitBase = "none"
  /\ landed = NoFact
  /\ patchChanges = 0 /\ baseMoves = 0

----------------------------------------------------------------------------

JudgeLocalPatch ==
  /\ judged = NoFact
  /\ judged' = [b |-> base, d |-> patch]
  /\ UNCHANGED <<base, patch, decided, commitReady, commitBase,
                 landed, patchChanges, baseMoves>>

LocalPatchChange ==
  /\ patchChanges < 1 /\ patch = "d1" /\ ~commitReady
  /\ patch' = "d2"
  /\ patchChanges' = patchChanges + 1
  /\ UNCHANGED <<base, judged, decided, commitReady, commitBase,
                 landed, baseMoves>>

LocalBaseMove ==
  /\ baseMoves < 1 /\ base = "b1"
  /\ base' = "b2"
  /\ baseMoves' = baseMoves + 1
  /\ UNCHANGED <<patch, judged, decided, commitReady, commitBase,
                 landed, patchChanges>>

CreateCommit ==
  /\ ~commitReady
  /\ commitReady' = TRUE
  /\ commitBase' = base
  /\ UNCHANGED <<base, patch, judged, decided, landed,
                 patchChanges, baseMoves>>

DecideLocalMerge ==
  /\ judged /= NoFact
  /\ decided = NoFact
  /\ commitReady
  /\ (~RecheckPatch \/ patch = judged.d)
  /\ (~RecheckBase \/ base = judged.b)
  /\ decided' = [b |-> base, d |-> patch]
  /\ UNCHANGED <<base, patch, judged, commitReady, commitBase,
                 landed, patchChanges, baseMoves>>

LandLocal ==
  /\ decided /= NoFact
  /\ landed = NoFact
  /\ (~FfCheck \/ base = commitBase)
  /\ landed' = [b |-> base, d |-> patch]
  /\ UNCHANGED <<base, patch, judged, decided, commitReady, commitBase,
                 patchChanges, baseMoves>>

----------------------------------------------------------------------------

Next ==
  \/ JudgeLocalPatch \/ LocalPatchChange \/ LocalBaseMove
  \/ CreateCommit \/ DecideLocalMerge \/ LandLocal

Spec == Init /\ [][Next]_vars

LocalLandingBindsJudgedPatch ==
  landed = NoFact
  \/ (judged /= NoFact /\ judged.b = landed.b /\ judged.d = landed.d)

=============================================================================
