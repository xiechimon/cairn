----------------------------- MODULE LocalLanding -----------------------------
EXTENDS Naturals

CONSTANTS RecheckPatch, RecheckBase, FfCheck, RebuildRefreshesChecks, MaxRejudges,
          AuthRecheck

VARIABLES base, patch, judged, decided, commitReady, commitBase, commitPatch,
          landed, patchChanges, baseMoves, rejudges, rebuilds,
          authorized, rechecked, revocations

Bases   == {"b1", "b2"}
Digests == {"d1", "d2"}
Fact     == [b : Bases, d : Digests]
NoFact   == [b |-> "none", d |-> "none"]
FactVal  == Fact \cup {NoFact}

vars == <<base, patch, judged, decided, commitReady, commitBase, commitPatch,
          landed, patchChanges, baseMoves, rejudges, rebuilds,
          authorized, rechecked, revocations>>

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
  /\ authorized \in BOOLEAN
  /\ rechecked \in BOOLEAN
  /\ revocations \in 0..1

Init ==
  /\ base = "b1" /\ patch = "d1"
  /\ judged = NoFact /\ decided = NoFact
  /\ commitReady = FALSE /\ commitBase = "none" /\ commitPatch = "none"
  /\ landed = NoFact
  /\ patchChanges = 0 /\ baseMoves = 0
  /\ rejudges = 0 /\ rebuilds = 0
  /\ authorized = TRUE /\ rechecked = FALSE /\ revocations = 0

CommitFact == [b |-> commitBase, d |-> commitPatch]
CheckTarget == IF RebuildRefreshesChecks /\ rebuilds >= 1 THEN CommitFact ELSE judged
JudgementDrifted == judged /= NoFact /\ (judged.b /= base \/ judged.d /= patch)
CommitDrifted == commitReady /\ (commitBase /= base \/ commitPatch /= patch)

----------------------------------------------------------------------------

JudgeLocalPatch ==
  /\ judged = NoFact
  /\ judged' = [b |-> base, d |-> patch]
  /\ UNCHANGED <<base, patch, decided, commitReady, commitBase, commitPatch,
                 landed, patchChanges, baseMoves, rejudges, rebuilds,
                 authorized, rechecked, revocations>>

LocalPatchChange ==
  /\ patchChanges < 1 /\ patch = "d1" /\ landed = NoFact
  /\ patch' = "d2"
  /\ patchChanges' = patchChanges + 1
  /\ UNCHANGED <<base, judged, decided, commitReady, commitBase, commitPatch,
                 landed, baseMoves, rejudges, rebuilds,
                 authorized, rechecked, revocations>>

LocalBaseMove ==
  /\ baseMoves < 1 /\ base = "b1"
  /\ base' = "b2"
  /\ baseMoves' = baseMoves + 1
  /\ UNCHANGED <<patch, judged, decided, commitReady, commitBase, commitPatch,
                 landed, patchChanges, rejudges, rebuilds,
                 authorized, rechecked, revocations>>

CreateCommit ==
  /\ ~commitReady
  /\ commitReady' = TRUE
  /\ commitBase' = base
  /\ commitPatch' = patch
  /\ UNCHANGED <<base, patch, judged, decided, landed,
                 patchChanges, baseMoves, rejudges, rebuilds,
                 authorized, rechecked, revocations>>

Rejudge ==
  /\ landed = NoFact /\ rejudges < MaxRejudges /\ JudgementDrifted
  /\ judged' = [b |-> base, d |-> patch]
  /\ decided' = NoFact
  /\ rechecked' = FALSE
  /\ rejudges' = rejudges + 1
  /\ UNCHANGED <<base, patch, commitReady, commitBase, commitPatch,
                 landed, patchChanges, baseMoves, rebuilds,
                 authorized, revocations>>

Rebuild ==
  /\ landed = NoFact /\ rebuilds < MaxRejudges /\ CommitDrifted
  /\ commitBase' = base
  /\ commitPatch' = patch
  /\ decided' = NoFact
  /\ rechecked' = FALSE
  /\ rebuilds' = rebuilds + 1
  /\ UNCHANGED <<base, patch, judged, commitReady,
                 landed, patchChanges, baseMoves, rejudges,
                 authorized, revocations>>

DecideLocalMerge ==
  /\ judged /= NoFact
  /\ decided = NoFact
  /\ commitReady
  /\ (~RecheckPatch \/ (patch = CheckTarget.d /\ commitPatch = CheckTarget.d))
  /\ (~RecheckBase \/ (base = CheckTarget.b /\ commitBase = CheckTarget.b))
  /\ decided' = [b |-> base, d |-> patch]
  /\ UNCHANGED <<base, patch, judged, commitReady, commitBase, commitPatch,
                 landed, patchChanges, baseMoves, rejudges, rebuilds,
                 authorized, rechecked, revocations>>

AuthorizeLanding ==
  /\ decided /= NoFact
  /\ landed = NoFact
  /\ rechecked' = authorized
  /\ UNCHANGED <<base, patch, judged, decided, commitReady, commitBase,
                 commitPatch, landed, patchChanges, baseMoves, rejudges,
                 rebuilds, authorized, revocations>>

RevokeAuthorization ==
  /\ authorized
  /\ revocations < 1
  /\ landed = NoFact
  /\ authorized' = FALSE
  /\ revocations' = revocations + 1
  /\ UNCHANGED <<base, patch, judged, decided, commitReady, commitBase,
                 commitPatch, landed, patchChanges, baseMoves, rejudges,
                 rebuilds, rechecked>>

LandLocal ==
  /\ decided /= NoFact
  /\ landed = NoFact
  /\ (~FfCheck \/ base = commitBase)
  /\ (~AuthRecheck \/ rechecked)
  /\ landed' = [b |-> base, d |-> commitPatch]
  /\ UNCHANGED <<base, patch, judged, decided, commitReady, commitBase,
                 commitPatch, patchChanges, baseMoves, rejudges, rebuilds,
                 authorized, rechecked, revocations>>

----------------------------------------------------------------------------

Next ==
  \/ JudgeLocalPatch \/ LocalPatchChange \/ LocalBaseMove
  \/ CreateCommit \/ DecideLocalMerge \/ LandLocal
  \/ AuthorizeLanding \/ RevokeAuthorization
  \/ Rejudge \/ Rebuild

Spec == Init /\ [][Next]_vars

LocalLandingBindsJudgedPatch ==
  landed = NoFact
  \/ (judged /= NoFact /\ judged.b = landed.b /\ judged.d = landed.d)

LocalLandingHeldAuthorization ==
  landed = NoFact \/ rechecked

DriftHasWayOut ==
  landed = NoFact =>
    /\ (JudgementDrifted => rejudges < MaxRejudges)
    /\ (CommitDrifted => rebuilds < MaxRejudges)

NeverLandedAfterRejudge == ~(landed /= NoFact /\ rejudges >= 1)

NeverLandedAfterRebuild == ~(landed /= NoFact /\ rebuilds >= 1)

NeverLandedAfterBothDriftsRebuilt ==
  ~(landed /= NoFact /\ rejudges >= 2 /\ rebuilds >= 2)

NeverLandedWithAuthorization == ~(landed /= NoFact /\ rechecked)

NeverLandedAfterRevoke == ~(landed /= NoFact /\ revocations >= 1)

=============================================================================
