----------------------------- MODULE StepClaim -----------------------------
\* Action-to-code map, bounds and assumptions: ../SKILL.md
EXTENDS Naturals, FiniteSets

CONSTANTS Machines, NoMachine, ExecIds, InitialHome,
          MaxClaims, MaxPartitions, MaxCrashes, MaxRebinds

VARIABLES
  st, sm, fresh, progressed, probeDue,
  phase, stopPending,
  online, presenceFresh, home,
  connected, dm, stopEvt, stopInHand, journal, jout, jstop,
  ex,
  holder, staleApply, stopDelivered,
  claims, partitions, crashes, rebinds

server  == <<st, sm, fresh, progressed, probeDue, phase, stopPending,
             online, presenceFresh, home>>
daemon  == <<connected, dm, stopEvt, stopInHand, journal, jout, jstop>>
ghosts  == <<holder, staleApply, stopDelivered>>
budgets == <<claims, partitions, crashes, rebinds>>
vars    == <<server, daemon, ex, ghosts, budgets>>

None     == 0
Statuses == {"pending", "claimed", "done", "failed", "stopped", "waiting_quota"}
Stages   == {"idle", "preparing", "running", "reporting", "applying", "orphan", "gone"}
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
  /\ stopEvt \in [Machines -> BOOLEAN] /\ stopInHand \in [Machines -> BOOLEAN]
  /\ journal \in [Machines -> {"none", "active", "awaiting"}]
  /\ jout \in [Machines -> Outcomes \cup {"none"}]
  /\ jstop \in [Machines -> BOOLEAN]
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
  /\ stopEvt = [m \in Machines |-> FALSE] /\ stopInHand = [m \in Machines |-> FALSE]
  /\ journal = [m \in Machines |-> "none"] /\ jout = [m \in Machines |-> "none"]
  /\ jstop = [m \in Machines |-> FALSE]
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
  \/ \E e \in ExecIds : ex[e].mach = m /\ ex[e].stage \in Live \cup {"orphan"}

KeepsFresh ==
  /\ sm /= NoMachine
  /\ connected[sm]
  /\ \E e \in ExecIds : ex[e].mach = sm /\ ex[e].stage = "running" /\ ex[e].beat

----------------------------------------------------------------------------

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
  /\ jstop' = [jstop EXCEPT ![m] = FALSE]
  /\ claims' = claims + 1
  /\ UNCHANGED <<probeDue, phase, stopPending, online, presenceFresh, home,
                 connected, dm, stopEvt, stopInHand,
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

StartSession(e) ==
  /\ ex[e].stage = "preparing" /\ ~ex[e].halt
  /\ ex' = [ex EXCEPT ![e].stage = "running", ![e].beat = FALSE]
  /\ UNCHANGED <<server, daemon, ghosts, budgets>>

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
  IF ex[e].stage = "preparing"
    THEN IF ex[e].halt THEN {"failed", "stopped"} ELSE {"failed"}
  ELSE IF ex[e].halt THEN {"stopped", "success"}
  ELSE {"success", "failed", "quota"}

FinishSession(e) ==
  LET m == ex[e].mach IN
  /\ ex[e].stage \in Working
  /\ \E o \in FinishOutcomes(e) :
       /\ ex' = [ex EXCEPT ![e].stage = "reporting", ![e].out = o,
                                 ![e].beat = FALSE, ![e].halt = FALSE]
       /\ jout' = [jout EXCEPT ![m] = o]
  /\ journal' = [journal EXCEPT ![m] = "awaiting"]
  /\ UNCHANGED <<server, connected, dm, stopEvt, stopInHand, jstop, ghosts, budgets>>

ApplyOutcome(e) ==
  LET m       == ex[e].mach
      o       == ex[e].out
      orphan  == ex[e].stage = "orphan" IN
  /\ st' = CASE o = "quota"   -> "waiting_quota"
             [] o = "success" -> "done"
             [] o = "failed"  -> "failed"
             [] o = "stopped" -> "stopped"
  /\ probeDue' = FALSE
  /\ stopPending' = FALSE
  /\ staleApply' = (staleApply \/ holder /= e)
  /\ holder' = None
  /\ ex' = [ex EXCEPT ![e] = Gone]
  /\ journal' = IF orphan THEN journal ELSE [journal EXCEPT ![m] = "none"]
  /\ jout' = IF orphan THEN jout ELSE [jout EXCEPT ![m] = "none"]
  /\ jstop' = IF orphan THEN jstop ELSE [jstop EXCEPT ![m] = FALSE]
  /\ UNCHANGED <<sm, fresh, progressed, phase, online, presenceFresh, home,
                 connected, dm, stopEvt, stopInHand, stopDelivered, budgets>>

FinishStepOwnedCheck(e) ==
  LET m == ex[e].mach IN
  /\ ex[e].stage = "reporting"
  /\ IF connected[m] /\ sm = m
       THEN IF ex[e].out = "success"
              THEN /\ ex' = [ex EXCEPT ![e].stage = "applying"]
                   /\ UNCHANGED <<server, journal, jout, jstop, ghosts>>
              ELSE ApplyOutcome(e)
       ELSE /\ ex' = [ex EXCEPT ![e] = Gone]
            /\ UNCHANGED <<server, journal, jout, jstop, ghosts>>
  /\ UNCHANGED <<connected, dm, stopEvt, stopInHand, budgets>>

FinishStepApply(e) ==
  /\ ex[e].stage \in {"applying", "orphan"}
  /\ ApplyOutcome(e)

----------------------------------------------------------------------------

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
                 connected, dm, stopInHand, journal, jout, jstop,
                 ex, ghosts, budgets>>

DeliverStopFetch(m) ==
  /\ stopEvt[m] /\ dm[m] = "up" /\ connected[m]
  /\ stopEvt' = [stopEvt EXCEPT ![m] = FALSE]
  /\ IF st = "claimed" /\ sm = m /\ stopPending
       THEN /\ stopPending' = FALSE
            /\ stopInHand' = [stopInHand EXCEPT ![m] = TRUE]
       ELSE UNCHANGED <<stopPending, stopInHand>>
  /\ UNCHANGED <<st, sm, fresh, progressed, probeDue, phase, online, presenceFresh, home,
                 connected, dm, journal, jout, jstop, ex, ghosts, budgets>>

DeliverStopToRuns(m) ==
  /\ stopInHand[m]
  /\ stopInHand' = [stopInHand EXCEPT ![m] = FALSE]
  /\ stopDelivered' = [stopDelivered EXCEPT ![m] = TRUE]
  /\ jstop' = IF journal[m] /= "none" /\ \E e \in ExecIds : ex[e].mach = m /\ ex[e].stage \in Working
                THEN [jstop EXCEPT ![m] = TRUE]
                ELSE jstop
  /\ ex' = [e \in ExecIds |->
              IF ex[e].mach = m /\ ex[e].stage \in Working
                THEN [ex[e] EXCEPT !.halt = TRUE]
                ELSE ex[e]]
  /\ UNCHANGED <<server, connected, dm, stopEvt, journal, jout,
                 holder, staleApply, budgets>>

----------------------------------------------------------------------------

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

MachineStreamAbort(m) ==
  /\ Involved(m)
  /\ online[m]
  /\ online' = [online EXCEPT ![m] = FALSE]
  /\ stopEvt' = [stopEvt EXCEPT ![m] = FALSE]
  /\ UNCHANGED <<st, sm, fresh, progressed, probeDue, phase, stopPending, presenceFresh, home,
                 connected, dm, stopInHand, journal, jout, jstop, ex, ghosts, budgets>>

Partition(m) ==
  /\ Involved(m)
  /\ connected[m] /\ partitions < MaxPartitions
  /\ connected' = [connected EXCEPT ![m] = FALSE]
  /\ stopEvt' = [stopEvt EXCEPT ![m] = FALSE]
  /\ partitions' = partitions + 1
  /\ UNCHANGED <<server, dm, stopInHand, journal, jout, jstop, ex, ghosts,
                 claims, crashes, rebinds>>

Reconnect(m) ==
  /\ Involved(m)
  /\ ~connected[m]
  /\ connected' = [connected EXCEPT ![m] = TRUE]
  /\ UNCHANGED <<server, dm, stopEvt, stopInHand, journal, jout, jstop, ex,
                 ghosts, budgets>>

DaemonCrash(m) ==
  /\ Involved(m)
  /\ dm[m] /= "down" /\ crashes < MaxCrashes
  /\ dm' = [dm EXCEPT ![m] = "down"]
  /\ ex' = [e \in ExecIds |->
              IF ex[e].mach /= m THEN ex[e]
              ELSE IF ex[e].stage \in {"preparing", "running", "reporting"} THEN Gone
              ELSE IF ex[e].stage = "applying" THEN [ex[e] EXCEPT !.stage = "orphan"]
              ELSE ex[e]]
  /\ stopEvt' = [stopEvt EXCEPT ![m] = FALSE]
  /\ stopInHand' = [stopInHand EXCEPT ![m] = FALSE]
  /\ crashes' = crashes + 1
  /\ UNCHANGED <<server, connected, journal, jout, jstop, ghosts, claims, partitions,
                 rebinds>>

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
                                      ELSE IF jstop[m]
                                        THEN NewExec(m, "reporting", "stopped")
                                        ELSE NewExec(m, "preparing", "none")]
                        /\ holder' = e
                   /\ dm' = [dm EXCEPT ![m] = "recovering"]
                   /\ UNCHANGED <<st, stopPending>>
       ELSE /\ dm' = [dm EXCEPT ![m] = "up"]
            /\ UNCHANGED <<st, stopPending, ex, holder>>
  /\ UNCHANGED <<sm, fresh, progressed, probeDue, phase, home,
                 connected, stopEvt, stopInHand, journal, jout, jstop,
                 staleApply, stopDelivered, budgets>>

DaemonRecoverDone(m) ==
  /\ dm[m] = "recovering"
  /\ ~\E e \in ExecIds : ex[e].mach = m /\ ex[e].stage \in Live
  /\ dm' = [dm EXCEPT ![m] = "up"]
  /\ UNCHANGED <<server, connected, stopEvt, stopInHand, journal, jout, jstop,
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
       \/ DeliverStopFetch(m) \/ DeliverStopToRuns(m)
       \/ PresenceAges(m) \/ MarkPresence(m) \/ MachineStreamAbort(m)
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
    connected, dm, stopEvt, stopInHand, journal,
    [m \in Machines |-> IF journal[m] = "awaiting" THEN jout[m] ELSE "none"], jstop,
    ex, ghosts, budgets>>

----------------------------------------------------------------------------

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
