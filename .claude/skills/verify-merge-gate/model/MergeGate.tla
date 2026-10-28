----------------------------- MODULE MergeGate -----------------------------
EXTENDS Naturals

CONSTANTS Protected, BindingBound, ReviewHeadBound, MergeRechecksDigest, MaxVerdicts

VARIABLES head, base, dgst,
          verdictRows,
          lastEval, satVerify, satDecision, satReview, satReviewHead,
          landed,
          verdicts, codePushes, evidencePushes, benignMoves, interactingMoves

Kinds    == {"verify", "review", "decision"}
Digests  == {"d1", "d2"}
Heads    == {"h1", "h2"}
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

vars == <<head, base, dgst, verdictRows, lastEval,
          satVerify, satDecision, satReview, satReviewHead, landed,
          verdicts, codePushes, evidencePushes, benignMoves, interactingMoves>>

TypeOK ==
  /\ head \in Heads
  /\ base \in Bases
  /\ dgst \in Digests
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

ReadyAt(h, b, d) ==
  /\ b = "b1"
  /\ VerifyOk(d) /\ DecisionOk(d) /\ ReviewOk(d)
  /\ (~Protected \/ IndependentOk(h, d))

----------------------------------------------------------------------------

RecordVerdict(k) ==
  /\ verdicts < MaxVerdicts
  /\ \E o \in {"pass", "block"}, indep \in BOOLEAN,
        rh \in (IF evidencePushes = 1 THEN Heads ELSE {head}) :
       /\ verdictRows' = verdictRows \cup
            {[kind |-> k, digest |-> dgst, outcome |-> o,
              independent |-> IF k = "review" THEN indep ELSE FALSE,
              recordedHead |-> IF k = "review" THEN rh ELSE "h1"]}
       /\ verdicts' = verdicts + 1
  /\ lastEval' = NoEval
  /\ UNCHANGED <<head, base, dgst,
                 satVerify, satDecision, satReview, satReviewHead, landed,
                 codePushes, evidencePushes, benignMoves, interactingMoves>>

PushCode ==
  /\ codePushes < 1 /\ head = "h1" /\ dgst = "d1"
  /\ head' = "h2" /\ dgst' = "d2"
  /\ codePushes' = codePushes + 1
  /\ lastEval' = NoEval
  /\ UNCHANGED <<base, verdictRows,
                 satVerify, satDecision, satReview, satReviewHead, landed,
                 verdicts, evidencePushes, benignMoves, interactingMoves>>

PushEvidence ==
  /\ evidencePushes < 1 /\ head = "h1"
  /\ head' = "h2"
  /\ evidencePushes' = evidencePushes + 1
  /\ lastEval' = NoEval
  /\ UNCHANGED <<base, dgst, verdictRows,
                 satVerify, satDecision, satReview, satReviewHead, landed,
                 verdicts, codePushes, benignMoves, interactingMoves>>

BaseMoveBenign ==
  /\ benignMoves < 1 /\ base = "b1"
  /\ base' = "b2"
  /\ benignMoves' = benignMoves + 1
  /\ UNCHANGED <<head, dgst, verdictRows, lastEval,
                 satVerify, satDecision, satReview, satReviewHead, landed,
                 verdicts, codePushes, evidencePushes, interactingMoves>>

BaseMoveInteracting ==
  /\ interactingMoves < 1 /\ base = "b1" /\ dgst = "d1"
  /\ base' = "b2" /\ dgst' = "d2"
  /\ interactingMoves' = interactingMoves + 1
  /\ UNCHANGED <<head, verdictRows, lastEval,
                 satVerify, satDecision, satReview, satReviewHead, landed,
                 verdicts, codePushes, evidencePushes, benignMoves>>

Evaluate ==
  /\ lastEval' = [h |-> head, b |-> base, d |-> dgst,
                  ready |-> ReadyAt(head, base, dgst)]
  /\ IF ReadyAt(head, base, dgst)
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
  /\ UNCHANGED <<head, base, dgst, verdictRows, landed,
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
  /\ UNCHANGED <<head, base, dgst, verdictRows, lastEval,
                 satVerify, satDecision, satReview, satReviewHead,
                 verdicts, codePushes, evidencePushes, benignMoves,
                 interactingMoves>>

----------------------------------------------------------------------------

Next ==
  \/ PushCode \/ PushEvidence \/ BaseMoveBenign \/ BaseMoveInteracting
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

=============================================================================
