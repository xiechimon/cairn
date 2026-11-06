----------------------------- MODULE MergeGate -----------------------------
EXTENDS Naturals

CONSTANTS Protected, BindingBound, ReviewHeadBound, MergeRechecksDigest,
          RequireUpToDate, AllowCodePush, AllowEvidencePush, MaxVerdicts

VARIABLES head, base, dgst, used, carriers, updates,
          verdictRows,
          lastEval, satVerify, satDecision, satReview, satReviewHead,
          landed,
          verdicts, codePushes, evidencePushes, benignMoves, interactingMoves

Kinds    == {"verify", "review", "decision"}
Digests  == {"d1", "d2"}
Heads    == {"h1", "h2", "h3"}
Bases    == {"b1", "b2"}
Outcomes == {"none", "pass", "block"}
VerdictRow == [kind : Kinds, digest : Digests, outcome : {"pass", "block"},
               independent : BOOLEAN, recordedHead : Heads]
EvalSnap == [h : Heads, b : Bases, d : Digests, ready : BOOLEAN]
NoEval == [h |-> "none", b |-> "none", d |-> "none", ready |-> FALSE]
EvalVal == EvalSnap \cup {NoEval}
HeadsOrNone == Heads \cup {"none"}
DigestsOrNone == Digests \cup {"none"}
LandingVal == [h : HeadsOrNone, d : DigestsOrNone,
               v : Outcomes, rv : Outcomes, dv : Outcomes,
               indep : BOOLEAN, rh : HeadsOrNone]
NoLanding == [h |-> "none", d |-> "none", v |-> "pass", rv |-> "pass",
              dv |-> "pass", indep |-> FALSE, rh |-> "none"]

vars == <<head, base, dgst, used, carriers, updates, verdictRows, lastEval,
          satVerify, satDecision, satReview, satReviewHead, landed,
          verdicts, codePushes, evidencePushes, benignMoves, interactingMoves>>

TypeOK ==
  /\ head \in Heads
  /\ base \in Bases
  /\ dgst \in Digests
  /\ used \subseteq Heads
  /\ carriers \subseteq used
  /\ head \in carriers
  /\ updates \in 0..1
  /\ verdictRows \subseteq VerdictRow
  /\ lastEval \in EvalVal
  /\ satVerify \in Digests \cup {"none"}
  /\ satDecision \in Digests \cup {"none"}
  /\ satReview \in Digests \cup {"none"}
  /\ satReviewHead \in Heads \cup {"none"}
  /\ landed \in LandingVal
  /\ verdicts \in 0..MaxVerdicts
  /\ codePushes \in 0..1
  /\ evidencePushes \in 0..1
  /\ benignMoves \in 0..1
  /\ interactingMoves \in 0..1

Init ==
  /\ head = "h1" /\ base = "b1" /\ dgst = "d1"
  /\ used = {"h1"} /\ carriers = {"h1"} /\ updates = 0
  /\ verdictRows = {}
  /\ lastEval = NoEval
  /\ satVerify = "none" /\ satDecision = "none"
  /\ satReview = "none" /\ satReviewHead = "none"
  /\ landed = NoLanding
  /\ verdicts = 0
  /\ codePushes = 0 /\ evidencePushes = 0
  /\ benignMoves = 0 /\ interactingMoves = 0

HasPassAt(k, d) ==
  \E v \in verdictRows : v.kind = k /\ v.digest = d /\ v.outcome = "pass"
HasBlockAt(k, d) ==
  \E v \in verdictRows : v.kind = k /\ v.digest = d /\ v.outcome = "block"
OutcomeAt(k, d) ==
  IF HasBlockAt(k, d) THEN "block"
  ELSE IF HasPassAt(k, d) THEN "pass" ELSE "none"

HasPass(k, d) ==
  IF BindingBound THEN HasPassAt(k, d)
  ELSE \E dd \in Digests : HasPassAt(k, dd)
HasBlock(k, d) ==
  IF BindingBound THEN HasBlockAt(k, d)
  ELSE \E dd \in Digests : HasBlockAt(k, dd)
SatDigest(k, d) ==
  IF BindingBound THEN d
  ELSE CHOOSE dd \in Digests : HasPassAt(k, dd)

VerifyOk(d)   == HasPass("verify", d) /\ ~HasBlock("verify", d)
DecisionOk(d) == HasPass("decision", d) /\ ~HasBlock("decision", d)
ReviewOk(d)   == HasPass("review", d) /\ ~HasBlock("review", d)
IndependentRows(h, d) ==
  {v \in verdictRows : v.kind = "review" /\ v.digest = d
    /\ v.outcome = "pass" /\ v.independent
    /\ (~ReviewHeadBound \/ v.recordedHead = h)}
IndependentOk(h, d) == IndependentRows(h, SatDigest("review", d)) /= {}
ReviewHeadAt(h, d) ==
  IF IndependentRows(h, d) = {} THEN "none"
  ELSE (CHOOSE v \in IndependentRows(h, d) : TRUE).recordedHead

FreshHead == IF "h2" \notin used THEN "h2" ELSE "h3"
Synced == base = "b1" \/ updates = 1

ReadyAt(h, d) ==
  /\ (~RequireUpToDate \/ Synced)
  /\ VerifyOk(d) /\ DecisionOk(d) /\ ReviewOk(d)
  /\ (~Protected \/ IndependentOk(h, d))

----------------------------------------------------------------------------

RecordVerdict(k) ==
  /\ verdicts < MaxVerdicts
  /\ \E o \in {"pass", "block"}, indep \in BOOLEAN, rh \in carriers :
       /\ verdictRows' = verdictRows \cup
            {[kind |-> k, digest |-> dgst, outcome |-> o,
              independent |-> IF k = "review" THEN indep ELSE FALSE,
              recordedHead |-> IF k = "review" THEN rh ELSE "h1"]}
       /\ verdicts' = verdicts + 1
  /\ lastEval' = NoEval
  /\ UNCHANGED <<head, base, dgst, used, carriers, updates,
                 satVerify, satDecision, satReview, satReviewHead, landed,
                 codePushes, evidencePushes, benignMoves, interactingMoves>>

PushCode ==
  /\ AllowCodePush
  /\ codePushes + evidencePushes < 1 /\ dgst = "d1" /\ used /= Heads
  /\ head' = FreshHead /\ dgst' = "d2"
  /\ used' = used \cup {FreshHead}
  /\ carriers' = {FreshHead}
  /\ codePushes' = codePushes + 1
  /\ lastEval' = NoEval
  /\ UNCHANGED <<base, updates, verdictRows,
                 satVerify, satDecision, satReview, satReviewHead, landed,
                 verdicts, evidencePushes, benignMoves, interactingMoves>>

PushEvidence ==
  /\ AllowEvidencePush
  /\ codePushes + evidencePushes < 1 /\ used /= Heads
  /\ head' = FreshHead
  /\ used' = used \cup {FreshHead}
  /\ carriers' = carriers \cup {FreshHead}
  /\ evidencePushes' = evidencePushes + 1
  /\ lastEval' = NoEval
  /\ UNCHANGED <<base, dgst, updates, verdictRows,
                 satVerify, satDecision, satReview, satReviewHead, landed,
                 verdicts, codePushes, benignMoves, interactingMoves>>

UpdateBranch ==
  /\ updates < 1 /\ ~Synced /\ used /= Heads
  /\ head' = FreshHead
  /\ used' = used \cup {FreshHead}
  /\ carriers' = carriers \cup {FreshHead}
  /\ updates' = updates + 1
  /\ lastEval' = NoEval
  /\ UNCHANGED <<base, dgst, verdictRows,
                 satVerify, satDecision, satReview, satReviewHead, landed,
                 verdicts, codePushes, evidencePushes, benignMoves,
                 interactingMoves>>

BaseMoveBenign ==
  /\ benignMoves < 1 /\ base = "b1"
  /\ base' = "b2"
  /\ benignMoves' = benignMoves + 1
  /\ UNCHANGED <<head, dgst, used, carriers, updates, verdictRows, lastEval,
                 satVerify, satDecision, satReview, satReviewHead, landed,
                 verdicts, codePushes, evidencePushes, interactingMoves>>

BaseMoveInteracting ==
  /\ interactingMoves < 1 /\ base = "b1" /\ dgst = "d1"
  /\ base' = "b2" /\ dgst' = "d2"
  /\ interactingMoves' = interactingMoves + 1
  /\ UNCHANGED <<head, used, carriers, updates, verdictRows, lastEval,
                 satVerify, satDecision, satReview, satReviewHead, landed,
                 verdicts, codePushes, evidencePushes, benignMoves>>

Evaluate ==
  /\ lastEval' = [h |-> head, b |-> base, d |-> dgst,
                  ready |-> ReadyAt(head, dgst)]
  /\ IF ReadyAt(head, dgst)
       THEN /\ satVerify' = SatDigest("verify", dgst)
            /\ satDecision' = SatDigest("decision", dgst)
            /\ satReview' = SatDigest("review", dgst)
            /\ satReviewHead' = IF Protected
                                  THEN ReviewHeadAt(head, SatDigest("review", dgst))
                                  ELSE "none"
       ELSE /\ satVerify' = "none"
            /\ satDecision' = "none"
            /\ satReview' = "none"
            /\ satReviewHead' = "none"
  /\ UNCHANGED <<head, base, dgst, used, carriers, updates, verdictRows, landed,
                 verdicts, codePushes, evidencePushes, benignMoves,
                 interactingMoves>>

ExecuteMergeGithub ==
  /\ lastEval.h \in Heads
  /\ lastEval.ready
  /\ lastEval.h = head
  /\ (~MergeRechecksDigest \/ lastEval.d = dgst)
  /\ landed.h = "none"
  /\ landed' = [h |-> head, d |-> dgst,
                 v |-> OutcomeAt("verify", dgst),
                 rv |-> OutcomeAt("review", dgst),
                 dv |-> OutcomeAt("decision", dgst),
                 indep |-> IndependentOk(head, dgst),
                 rh |-> ReviewHeadAt(head, SatDigest("review", dgst))]
  /\ UNCHANGED <<head, base, dgst, used, carriers, updates, verdictRows, lastEval,
                 satVerify, satDecision, satReview, satReviewHead,
                 verdicts, codePushes, evidencePushes, benignMoves,
                 interactingMoves>>

----------------------------------------------------------------------------

Next ==
  \/ PushCode \/ PushEvidence \/ BaseMoveBenign \/ BaseMoveInteracting
  \/ UpdateBranch
  \/ \E k \in Kinds : RecordVerdict(k)
  \/ Evaluate
  \/ ExecuteMergeGithub

Spec == Init /\ [][Next]_vars

MergeBoundToJudgedPatch ==
  landed.h = "none"
  \/ /\ landed.v = "pass"
     /\ landed.dv = "pass"
     /\ landed.rv = "pass"
     /\ ~Protected \/ (landed.indep /\ landed.rh = landed.h)

StaleVerdictNeverSatisfies ==
  \/ lastEval = NoEval
  \/ ~lastEval.ready
  \/ /\ satVerify = lastEval.d
     /\ satDecision = lastEval.d
     /\ satReview = lastEval.d
     /\ ~Protected \/ satReviewHead = lastEval.h

NeverReadyOnMovedBase == ~(lastEval.ready /\ lastEval.b = "b2")

NeverReadyOnInteractingUpdate ==
  ~(lastEval.ready /\ lastEval.b = "b2" /\ lastEval.d = "d2" /\ updates = 1)

NeverReadyOnBenignUpdate ==
  ~(lastEval.ready /\ lastEval.b = "b2" /\ lastEval.d = "d1" /\ updates = 1)

NeverMergedAfterUpdate ==
  ~(landed.h /= "none" /\ landed.h = head /\ updates = 1 /\ Synced)

=============================================================================
