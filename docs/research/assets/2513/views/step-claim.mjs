export const title = "Step claim (StepClaim.tla)";

const card = (v) => (v.archived ? "task archived" : v.phase === "closed" ? "card closed" : "card open");

export const state = (v) => {
  const status = {
    pending: "Pending",
    claimed: v.archiveStop !== "none" ? `Claimed, archive stop ${v.archiveStop}` : v.stopPending ? "Claimed, stop pending" : "Claimed",
    waiting_quota: "Waiting for quota",
    done: "Done",
    failed: "Failed",
    stopped: "Stopped",
  }[v.st];
  return `${status} (${card(v)})`;
};

export const group = (v) =>
  ["done", "failed", "stopped"].includes(v.st) ? "settled" : v.st === "claimed" ? "claimed" : "waiting";

export const colors = { waiting: "blue", claimed: "orange", settled: "teal" };

export const step = (action) =>
  ({
    TryClaim: "tryClaim",
    TryClaimResponseLost: "tryClaim (response lost)",
    StartSession: "session opens",
    HeartbeatStep: "heartbeatStep",
    FinishSession: "session ends",
    FinishStepOwnedCheck: "finishStep",
    FinishStepApply: "finishStep lands after await",
    SchedulerTick: "scheduler tick sweeps",
    CloseCard: "user closes card",
    ArchiveCard: "user archives task",
    EnqueueAfterArchive: "enqueueStep after archive",
    DeliverStopFetch: "fetchStop",
    DeliverStopToRun: "stop reaches run",
    HeartbeatAges: "heartbeat ages",
    PresenceAges: "presence ages",
    QuotaProbeDue: "quota probe due",
    MarkPresence: "markPresence",
    MachineStreamAbort: "push stream aborts",
    Partition: "network drops",
    Reconnect: "network returns",
    DaemonCrash: "daemon crashes",
    DaemonStartRecover: "daemon restarts, recover",
    DaemonRecoverDone: "recover finishes",
    RebindHomeMachine: "home machine rebound",
  })[action] ?? action;
