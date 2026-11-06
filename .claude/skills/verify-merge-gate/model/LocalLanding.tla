----------------------------- MODULE LocalLanding -----------------------------
EXTENDS Naturals

CONSTANTS RecheckPatch, RecheckBase, FfCheck, RebuildRefreshesChecks, MaxRejudges

VARIABLES base, patch, judged, decided, commitReady, commitBase, commitPatch,
          landed, patchChanges, baseMoves, rejudges, rebuilds

Bases   == {"b1", "b2"}
Digests == {"d1", "d2"}
Fact     == [b : Bases, d : Digests]
NoFact   == [b |-> "none", d |-> "none"]
FactVal  == Fact \cup {NoFact}

vars == <<base, patch, judged, decided, commitReady, commitBase, commitPatch,
          landed, patchChanges, baseMoves, rejudges, rebuilds>>

TypeOK ==
  /\ base \in Bases
  /\ patch \in Digests
  /\ judged \in FactVal
  /\ decided \in FactVal
  /\ commitReady \in BOOLEAN
  /\ commitBase \in Bases \cup {"none"}
  /\ commitPatch \in Digests \cup {"none"}
  /\ landed \in FactVal
  /\ patchChanges \in 0..1
  /\ baseMoves \in 0..1
  /\ rejudges \in 0..MaxRejudges
  /\ rebuilds \in 0..MaxRejudges

Init ==
  /\ base = "b1" /\ patch = "d1"
  /\ judged = NoFact /\ decided = NoFact
  /\ commitReady = FALSE /\ commitBase = "none" /\ commitPatch = "none"
  /\ landed = NoFact
  /\ patchChanges = 0 /\ baseMoves = 0
  /\ rejudges = 0 /\ rebuilds = 0

CommitFact == [b |-> commitBase, d |-> commitPatch]
CheckTarget == IF RebuildRefreshesChecks /\ rebuilds >= 1 THEN CommitFact ELSE judged
JudgementDrifted == judged /= NoFact /\ (judged.b /= base \/ judged.d /= patch)
CommitDrifted == commitReady /\ (commitBase /= base \/ commitPatch /= patch)

----------------------------------------------------------------------------

JudgeLocalPatch ==
  /\ judged = NoFact
  /\ judged' = [b |-> base, d |-> patch]
  /\ UNCHANGED <<base, patch, decided, commitReady, commitBase, commitPatch,
                 landed, patchChanges, baseMoves, rejudges, rebuilds>>

LocalPatchChange ==
  /\ patchChanges < 1 /\ patch = "d1" /\ landed = NoFact
  /\ patch' = "d2"
  /\ patchChanges' = patchChanges + 1
  /\ UNCHANGED <<base, judged, decided, commitReady, commitBase, commitPatch,
                 landed, baseMoves, rejudges, rebuilds>>

LocalBaseMove ==
  /\ baseMoves < 1 /\ base = "b1"
  /\ base' = "b2"
  /\ baseMoves' = baseMoves + 1
  /\ UNCHANGED <<patch, judged, decided, commitReady, commitBase, commitPatch,
                 landed, patchChanges, rejudges, rebuilds>>

CreateCommit ==
  /\ ~commitReady
  /\ commitReady' = TRUE
  /\ commitBase' = base
  /\ commitPatch' = patch
  /\ UNCHANGED <<base, patch, judged, decided, landed,
                 patchChanges, baseMoves, rejudges, rebuilds>>

Rejudge ==
  /\ landed = NoFact /\ rejudges < MaxRejudges /\ JudgementDrifted
  /\ judged' = [b |-> base, d |-> patch]
  /\ decided' = NoFact
  /\ rejudges' = rejudges + 1
  /\ UNCHANGED <<base, patch, commitReady, commitBase, commitPatch,
                 landed, patchChanges, baseMoves, rebuilds>>

Rebuild ==
  /\ landed = NoFact /\ rebuilds < MaxRejudges /\ CommitDrifted
  /\ commitBase' = base
  /\ commitPatch' = patch
  /\ decided' = NoFact
  /\ rebuilds' = rebuilds + 1
  /\ UNCHANGED <<base, patch, judged, commitReady,
                 landed, patchChanges, baseMoves, rejudges>>

DecideLocalMerge ==
  /\ judged /= NoFact
  /\ decided = NoFact
  /\ commitReady
  /\ (~RecheckPatch \/ (patch = CheckTarget.d /\ commitPatch = CheckTarget.d))
  /\ (~RecheckBase \/ (base = CheckTarget.b /\ commitBase = CheckTarget.b))
  /\ decided' = [b |-> base, d |-> patch]
  /\ UNCHANGED <<base, patch, judged, commitReady, commitBase, commitPatch,
                 landed, patchChanges, baseMoves, rejudges, rebuilds>>

LandLocal ==
  /\ decided /= NoFact
  /\ landed = NoFact
  /\ (~FfCheck \/ base = commitBase)
  /\ landed' = [b |-> base, d |-> commitPatch]
  /\ UNCHANGED <<base, patch, judged, decided, commitReady, commitBase,
                 commitPatch, patchChanges, baseMoves, rejudges, rebuilds>>

----------------------------------------------------------------------------

Next ==
  \/ JudgeLocalPatch \/ LocalPatchChange \/ LocalBaseMove
  \/ CreateCommit \/ DecideLocalMerge \/ LandLocal
  \/ Rejudge \/ Rebuild

Spec == Init /\ [][Next]_vars

LocalLandingBindsJudgedPatch ==
  landed = NoFact
  \/ (judged /= NoFact /\ judged.b = landed.b /\ judged.d = landed.d)

DriftHasWayOut ==
  landed = NoFact =>
    /\ (JudgementDrifted => rejudges < MaxRejudges)
    /\ (CommitDrifted => rebuilds < MaxRejudges)

NeverLandedAfterRejudge == ~(landed /= NoFact /\ rejudges >= 1)

NeverLandedAfterRebuild == ~(landed /= NoFact /\ rebuilds >= 1)

NeverLandedAfterBothDriftsRebuilt ==
  ~(landed /= NoFact /\ rejudges >= 2 /\ rebuilds >= 2)

=============================================================================
