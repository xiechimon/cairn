----------------------------- MODULE StepClaim -----------------------------
\* Action-to-code map, bounds and assumptions: ../SKILL.md
EXTENDS Naturals, FiniteSets

CONSTANTS Machines, NoMachine, ExecIds, InitialHome,
          MaxClaims, MaxPartitions, MaxCrashes, MaxRebinds

VARIABLES
  st, sm, fresh, progressed, probeDue,
  phase, stopPending,
  online, presenceFresh, home,
  connected, dm, handle, stopEvt, stopInHand, stopReq, journal, jout,
  ex,
  holder, staleApply, stopDelivered,
  claims, partitions, crashes, rebinds

server  == <<st, sm, fresh, progressed, probeDue, phase, stopPending,
             online, presenceFresh, home>>
daemon  == <<connected, dm, handle, stopEvt, stopInHand, stopReq, journal, jout>>
ghosts  == <<holder, staleApply, stopDelivered>>
budgets == <<claims, partitions, crashes, rebinds>>
vars    == <<server, daemon, ex, ghosts, budgets>>

None     == 0
Statuses == {"pending", "claimed", "done", "failed", "stopped", "waiting_quota"}
Stages   == {"idle", "preparing", "running", "reporting", "applying", "gone"}
Working  == {"preparing", "running"}
Live     == {"preparing", "running", "reporting", "applying"}
Outcomes == {"success", "failed", "stopped", "quota"}

Idle == [mach |-> InitialHome, stage |-> "idle", beat |-> FALSE,
         halt |-> FALSE, out |-> "none"]

TypeOK ==
  /\ st \in Statuses
  /\ sm \in Machines \cup {NoMachine}
  /\ fresh \in BOOLEAN /\ progressed \in BOOLEAN /\ probeDue \in BOOLEAN
  /\ phase \in {"open", "closed"}
  /\ stopPending \in BOOLEAN
  /\ online \in [Machines -> BOOLEAN] /\ presenceFresh \in [Machines -> BOOLEAN]
  /\ home \in Machines
  /\ connected \in [Machines -> BOOLEAN]
  /\ dm \in [Machines -> {"down", "recovering", "up"}]
  /\ handle \in [Machines -> ExecIds \cup {None}]
  /\ stopEvt \in [Machines -> BOOLEAN] /\ stopInHand \in [Machines -> BOOLEAN]
  /\ stopReq \in [Machines -> BOOLEAN]
  /\ journal \in [Machines -> {"none", "active", "awaiting"}]
  /\ jout \in [Machines -> Outcomes \cup {"none"}]
  /\ ex \in [ExecIds -> [mach : Machines, stage : Stages, beat : BOOLEAN,
                         halt : BOOLEAN, out : Outcomes \cup {"none"}]]
  /\ holder \in ExecIds \cup {None}
  /\ staleApply \in BOOLEAN
  /\ stopDelivered \in [Machines -> BOOLEAN]

Init ==
  /\ st = "pending" /\ sm = NoMachine /\ fresh = TRUE /\ progressed = FALSE
  /\ probeDue = FALSE
  /\ phase = "open" /\ stopPending = FALSE
  /\ online = [m \in Machines |-> TRUE] /\ presenceFresh = [m \in Machines |-> TRUE]
  /\ home = InitialHome
  /\ connected = [m \in Machines |-> TRUE]
  /\ dm = [m \in Machines |-> "up"]
  /\ handle = [m \in Machines |-> None]
  /\ stopEvt = [m \in Machines |-> FALSE] /\ stopInHand = [m \in Machines |-> FALSE]
  /\ stopReq = [m \in Machines |-> FALSE]
  /\ journal = [m \in Machines |-> "none"] /\ jout = [m \in Machines |-> "none"]
  /\ ex = [e \in ExecIds |-> Idle]
  /\ holder = None /\ staleApply = FALSE
  /\ stopDelivered = [m \in Machines |-> FALSE]
  /\ claims = 0 /\ partitions = 0 /\ crashes = 0 /\ rebinds = 0

FreeIds == {e \in ExecIds : ex[e].stage = "idle"}
NextId  == CHOOSE e \in FreeIds : \A f \in FreeIds : e <= f
NewExec(m, stage, out) ==
  [mach |-> m, stage |-> stage, beat |-> FALSE, halt |-> FALSE, out |-> out]
Gone == [Idle EXCEPT !.stage = "gone"]

Involved(m) ==
  \/ home = m \/ sm = m \/ journal[m] /= "none"
  \/ \E e \in ExecIds : ex[e].mach = m /\ ex[e].stage \in Live

KeepsFresh ==
  /\ sm /= NoMachine
  /\ connected[sm]
  /\ \E e \in ExecIds : ex[e].mach = sm /\ ex[e].stage = "running" /\ ex[e].beat

----------------------------------------------------------------------------
\* server: tryClaim (machines.ts) + daemon claim loop launching runStep

TryClaim(m) ==
  /\ dm[m] = "up" /\ connected[m]
  /\ st = "pending" /\ home = m
  /\ claims < MaxClaims /\ FreeIds /= {}
  /\ LET e == NextId IN
       /\ ex' = [ex EXCEPT ![e] = NewExec(m, "preparing", "none")]
       /\ holder' = e
  /\ st' = "claimed" /\ sm' = m /\ fresh' = TRUE /\ progressed' = FALSE
  /\ journal' = [journal EXCEPT ![m] = "active"]
  /\ jout' = [jout EXCEPT ![m] = "none"]
  /\ claims' = claims + 1
  /\ UNCHANGED <<probeDue, phase, stopPending, online, presenceFresh, home,
                 connected, dm, handle, stopEvt, stopInHand, stopReq,
                 staleApply, stopDelivered, partitions, crashes, rebinds>>

TryClaimResponseLost(m) ==
  /\ dm[m] = "up" /\ connected[m]
  /\ st = "pending" /\ home = m
  /\ claims < MaxClaims
  /\ st' = "claimed" /\ sm' = m /\ fresh' = TRUE /\ progressed' = FALSE
  /\ holder' = None
  /\ claims' = claims + 1
  /\ UNCHANGED <<probeDue, phase, stopPending, online, presenceFresh, home,
                 daemon, ex, staleApply, stopDelivered, partitions, crashes, rebinds>>

\* daemon runStep: workspace.prepare done -> heartbeat timer + session handle

StartSession(e) ==
  /\ ex[e].stage = "preparing"
  /\ ex' = [ex EXCEPT ![e].stage = "running", ![e].beat = FALSE]
  /\ handle' = [handle EXCEPT ![ex[e].mach] = e]
  /\ UNCHANGED <<server, connected, dm, stopEvt, stopInHand, stopReq, journal, jout,
                 ghosts, budgets>>

HeartbeatStep(e) ==
  LET m == ex[e].mach IN
  /\ ex[e].stage = "running" /\ connected[m]
  /\ sm = m
  /\ ~(fresh /\ progressed /\ ex[e].beat)
  /\ fresh' = TRUE /\ progressed' = TRUE
  /\ ex' = [ex EXCEPT ![e].beat = TRUE]
  /\ UNCHANGED <<st, sm, probeDue, phase, stopPending, online, presenceFresh, home,
                 daemon, ghosts, budgets>>

FinishOutcomes(e) ==
  IF ex[e].stage = "preparing" THEN {"failed"}
  ELSE IF stopReq[ex[e].mach] THEN {"stopped", "success"}
  ELSE IF ex[e].halt THEN {"failed", "success"}
  ELSE {"success", "failed", "quota"}

FinishSession(e) ==
  LET m == ex[e].mach IN
  /\ ex[e].stage \in Working
  /\ \E o \in FinishOutcomes(e) :
       /\ ex' = [ex EXCEPT ![e].stage = "reporting", ![e].out = o,
                                 ![e].beat = FALSE, ![e].halt = FALSE]
       /\ jout' = [jout EXCEPT ![m] = o]
  /\ stopReq' = IF ex[e].stage = "running" THEN [stopReq EXCEPT ![m] = FALSE] ELSE stopReq
  /\ journal' = [journal EXCEPT ![m] = "awaiting"]
  /\ UNCHANGED <<server, connected, dm, handle, stopEvt, stopInHand, ghosts, budgets>>

\* server: finishStep writes for the reported outcome, without re-checking step status

ApplyOutcome(e) ==
  LET m == ex[e].mach
      o == ex[e].out IN
  /\ st' = CASE o = "quota"   -> "waiting_quota"
             [] o = "success" -> "done"
             [] o = "failed"  -> "failed"
             [] o = "stopped" -> "stopped"
  /\ probeDue' = FALSE
  /\ stopPending' = FALSE
  /\ staleApply' = (staleApply \/ holder /= e)
  /\ holder' = None
  /\ ex' = [ex EXCEPT ![e] = Gone]
  /\ handle' = [handle EXCEPT ![m] = None]
  /\ journal' = IF dm[m] = "down" THEN journal ELSE [journal EXCEPT ![m] = "none"]
  /\ jout' = IF dm[m] = "down" THEN jout ELSE [jout EXCEPT ![m] = "none"]
  /\ UNCHANGED <<sm, fresh, progressed, phase, online, presenceFresh, home,
                 connected, dm, stopEvt, stopInHand, stopReq, stopDelivered, budgets>>

\* server: finishStep up to its first await. Only a success body can carry prUrl
\* (mergedPrElsewhere) or be a merge landing (applyMergeLanding); every other
\* outcome runs ownedStep and the writes in one synchronous block.

FinishStepOwnedCheck(e) ==
  LET m == ex[e].mach IN
  /\ ex[e].stage = "reporting"
  /\ IF connected[m] /\ sm = m
       THEN IF ex[e].out = "success"
              THEN /\ ex' = [ex EXCEPT ![e].stage = "applying"]
                   /\ UNCHANGED <<server, handle, journal, jout, ghosts>>
              ELSE ApplyOutcome(e)
       ELSE /\ ex' = [ex EXCEPT ![e] = Gone]
            /\ handle' = [handle EXCEPT ![m] = None]
            /\ UNCHANGED <<server, journal, jout, ghosts>>
  /\ UNCHANGED <<connected, dm, stopEvt, stopInHand, stopReq, budgets>>

\* server: finishStep after its awaits

FinishStepApply(e) ==
  /\ ex[e].stage = "applying"
  /\ ApplyOutcome(e)

----------------------------------------------------------------------------
\* scheduler tick: sweepStaleMachines; sweepAbandonedBuildSteps; sweepQuotaWaitSteps

SchedulerTick ==
  LET online1  == [m \in Machines |-> online[m] /\ presenceFresh[m]]
      leftover == phase = "closed" /\ st \in {"pending", "waiting_quota"}
      st1      == IF leftover THEN "stopped" ELSE st
      sp1      == IF leftover THEN FALSE ELSE stopPending
      stale    == st1 = "claimed" /\ ~fresh /\ (~online1[sm] \/ ~progressed)
      stopIt   == stale /\ phase = "closed"
      release  == stale /\ phase /= "closed"
      st2      == IF stopIt THEN "stopped" ELSE IF release THEN "pending" ELSE st1
      sm2      == IF release THEN NoMachine ELSE sm
      sp2      == IF stopIt THEN FALSE ELSE sp1
      quotaRel == st2 = "waiting_quota" /\ probeDue
      st3      == IF quotaRel THEN "pending" ELSE st2
      sm3      == IF quotaRel THEN NoMachine ELSE sm2
  IN
  /\ <<online1, st3, sm3, sp2>> /= <<online, st, sm, stopPending>>
  /\ online' = online1
  /\ st' = st3 /\ sm' = sm3 /\ stopPending' = sp2
  /\ holder' = IF release THEN None ELSE holder
  /\ UNCHANGED <<fresh, progressed, probeDue, phase, presenceFresh, home,
                 daemon, ex, staleApply, stopDelivered, budgets>>

----------------------------------------------------------------------------
\* user: stopActiveStepsAfterExit (close / mark done / back to todo)

CloseCard ==
  /\ phase = "open"
  /\ phase' = "closed"
  /\ IF st \in {"pending", "waiting_quota"}
       THEN /\ st' = "stopped" /\ stopPending' = FALSE
            /\ UNCHANGED stopEvt
       ELSE IF st = "claimed"
         THEN /\ stopPending' = TRUE
              /\ stopEvt' = [stopEvt EXCEPT ![sm] = (dm[sm] = "up" /\ connected[sm])]
              /\ UNCHANGED st
         ELSE UNCHANGED <<st, stopPending, stopEvt>>
  /\ UNCHANGED <<sm, fresh, progressed, probeDue, online, presenceFresh, home,
                 connected, dm, handle, stopInHand, stopReq, journal, jout,
                 ex, ghosts, budgets>>

\* daemon deliverStop: client.stop (server fetchStop) ...

DeliverStopFetch(m) ==
  /\ stopEvt[m] /\ dm[m] = "up" /\ connected[m]
  /\ stopEvt' = [stopEvt EXCEPT ![m] = FALSE]
  /\ IF st = "claimed" /\ sm = m /\ stopPending
       THEN /\ stopPending' = FALSE
            /\ stopInHand' = [stopInHand EXCEPT ![m] = TRUE]
       ELSE UNCHANGED <<stopPending, stopInHand>>
  /\ UNCHANGED <<st, sm, fresh, progressed, probeDue, phase, online, presenceFresh, home,
                 connected, dm, handle, stopReq, journal, jout, ex, ghosts, budgets>>

\* ... then sessionHandles.get(stepId)

DeliverStopToHandle(m) ==
  /\ stopInHand[m]
  /\ stopInHand' = [stopInHand EXCEPT ![m] = FALSE]
  /\ stopDelivered' = [stopDelivered EXCEPT ![m] = TRUE]
  /\ IF handle[m] /= None
       THEN /\ stopReq' = [stopReq EXCEPT ![m] = TRUE]
            /\ ex' = [ex EXCEPT ![handle[m]].halt = TRUE]
       ELSE UNCHANGED <<stopReq, ex>>
  /\ UNCHANGED <<server, connected, dm, handle, stopEvt, journal, jout,
                 holder, staleApply, budgets>>

----------------------------------------------------------------------------
\* environment: time passing, network, daemon process, agent home machine

HeartbeatAges ==
  /\ st = "claimed" /\ fresh /\ ~KeepsFresh
  /\ fresh' = FALSE
  /\ UNCHANGED <<st, sm, progressed, probeDue, phase, stopPending, online,
                 presenceFresh, home, daemon, ex, ghosts, budgets>>

PresenceAges(m) ==
  /\ Involved(m)
  /\ presenceFresh[m] /\ ~(dm[m] = "up" /\ connected[m])
  /\ presenceFresh' = [presenceFresh EXCEPT ![m] = FALSE]
  /\ UNCHANGED <<st, sm, fresh, progressed, probeDue, phase, stopPending, online, home,
                 daemon, ex, ghosts, budgets>>

QuotaProbeDue ==
  /\ st = "waiting_quota" /\ ~probeDue
  /\ probeDue' = TRUE
  /\ UNCHANGED <<st, sm, fresh, progressed, phase, stopPending, online,
                 presenceFresh, home, daemon, ex, ghosts, budgets>>

MarkPresence(m) ==
  /\ Involved(m)
  /\ dm[m] = "up" /\ connected[m]
  /\ ~(online[m] /\ presenceFresh[m])
  /\ online' = [online EXCEPT ![m] = TRUE]
  /\ presenceFresh' = [presenceFresh EXCEPT ![m] = TRUE]
  /\ UNCHANGED <<st, sm, fresh, progressed, probeDue, phase, stopPending, home,
                 daemon, ex, ghosts, budgets>>

Partition(m) ==
  /\ Involved(m)
  /\ connected[m] /\ partitions < MaxPartitions
  /\ connected' = [connected EXCEPT ![m] = FALSE]
  /\ stopEvt' = [stopEvt EXCEPT ![m] = FALSE]
  /\ partitions' = partitions + 1
  /\ UNCHANGED <<server, dm, handle, stopInHand, stopReq, journal, jout, ex, ghosts,
                 claims, crashes, rebinds>>

Reconnect(m) ==
  /\ Involved(m)
  /\ ~connected[m]
  /\ connected' = [connected EXCEPT ![m] = TRUE]
  /\ UNCHANGED <<server, dm, handle, stopEvt, stopInHand, stopReq, journal, jout, ex,
                 ghosts, budgets>>

DaemonCrash(m) ==
  /\ Involved(m)
  /\ dm[m] /= "down" /\ crashes < MaxCrashes
  /\ dm' = [dm EXCEPT ![m] = "down"]
  /\ ex' = [e \in ExecIds |->
              IF ex[e].mach = m /\ ex[e].stage \in {"preparing", "running", "reporting"}
                THEN Gone
                ELSE ex[e]]
  /\ handle' = [handle EXCEPT ![m] = None]
  /\ stopEvt' = [stopEvt EXCEPT ![m] = FALSE]
  /\ stopInHand' = [stopInHand EXCEPT ![m] = FALSE]
  /\ stopReq' = [stopReq EXCEPT ![m] = FALSE]
  /\ crashes' = crashes + 1
  /\ UNCHANGED <<server, connected, journal, jout, ghosts, claims, partitions, rebinds>>

\* daemon start: presence, then POST /api/machine/recover, resumed runStep is awaited
\* before the push stream, the presence timer and the claim loop start

DaemonStartRecover(m) ==
  /\ Involved(m)
  /\ dm[m] = "down" /\ connected[m]
  /\ online' = [online EXCEPT ![m] = TRUE]
  /\ presenceFresh' = [presenceFresh EXCEPT ![m] = TRUE]
  /\ IF st = "claimed" /\ sm = m
       THEN IF journal[m] = "none"
              THEN /\ st' = "failed" /\ stopPending' = FALSE /\ holder' = None
                   /\ dm' = [dm EXCEPT ![m] = "up"]
                   /\ UNCHANGED ex
              ELSE /\ FreeIds /= {}
                   /\ LET e == NextId IN
                        /\ ex' = [ex EXCEPT ![e] =
                                    IF journal[m] = "awaiting"
                                      THEN NewExec(m, "reporting", jout[m])
                                      ELSE NewExec(m, "preparing", "none")]
                        /\ holder' = e
                   /\ dm' = [dm EXCEPT ![m] = "recovering"]
                   /\ UNCHANGED <<st, stopPending>>
       ELSE /\ dm' = [dm EXCEPT ![m] = "up"]
            /\ UNCHANGED <<st, stopPending, ex, holder>>
  /\ UNCHANGED <<sm, fresh, progressed, probeDue, phase, home,
                 connected, handle, stopEvt, stopInHand, stopReq, journal, jout,
                 staleApply, stopDelivered, budgets>>

DaemonRecoverDone(m) ==
  /\ dm[m] = "recovering"
  /\ ~\E e \in ExecIds : ex[e].mach = m /\ ex[e].stage \in Live
  /\ dm' = [dm EXCEPT ![m] = "up"]
  /\ UNCHANGED <<server, connected, handle, stopEvt, stopInHand, stopReq, journal, jout,
                 ex, ghosts, budgets>>

RebindHomeMachine(m) ==
  /\ rebinds < MaxRebinds /\ m /= home
  /\ home' = m
  /\ rebinds' = rebinds + 1
  /\ UNCHANGED <<st, sm, fresh, progressed, probeDue, phase, stopPending, online,
                 presenceFresh, daemon, ex, ghosts, claims, partitions, crashes>>

----------------------------------------------------------------------------

Next ==
  \/ \E m \in Machines :
       \/ TryClaim(m) \/ TryClaimResponseLost(m)
       \/ DeliverStopFetch(m) \/ DeliverStopToHandle(m)
       \/ PresenceAges(m) \/ MarkPresence(m)
       \/ Partition(m) \/ Reconnect(m)
       \/ DaemonCrash(m) \/ DaemonStartRecover(m) \/ DaemonRecoverDone(m)
       \/ RebindHomeMachine(m)
  \/ \E e \in ExecIds :
       \/ StartSession(e) \/ HeartbeatStep(e) \/ FinishSession(e)
       \/ FinishStepOwnedCheck(e) \/ FinishStepApply(e)
  \/ SchedulerTick \/ CloseCard \/ HeartbeatAges \/ QuotaProbeDue

Spec == Init /\ [][Next]_vars

StateView ==
  <<st, sm,
    IF st = "claimed" THEN <<fresh, progressed>> ELSE <<>>,
    IF st = "waiting_quota" THEN probeDue ELSE FALSE,
    phase, stopPending, online, presenceFresh, home,
    connected, dm, handle, stopEvt, stopInHand, stopReq, journal,
    [m \in Machines |-> IF journal[m] = "awaiting" THEN jout[m] ELSE "none"],
    ex, ghosts, budgets>>

----------------------------------------------------------------------------
\* properties

SingleExecutorPerMachine ==
  \A m \in Machines :
    Cardinality({e \in ExecIds : ex[e].mach = m /\ ex[e].stage \in Working}) <= 1

OnlyHolderResultApplied == ~staleApply

NoClaimAfterClose ==
  [][phase = "closed" => ~(st /= "claimed" /\ st' = "claimed")]_vars

AcceptedStopReachesWorkers ==
  \A m \in Machines :
    stopDelivered[m] =>
      \A e \in ExecIds : (ex[e].mach = m /\ ex[e].stage \in Working) => ex[e].halt

=============================================================================
