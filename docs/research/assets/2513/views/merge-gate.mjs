export const title = "GitHub merge gate (MergeGate.tla)";

const rows = (v) => (Array.isArray(v.verdictRows) ? v.verdictRows : Object.values(v.verdictRows ?? {}));
const okAt = (v, kind, d) => {
  const at = rows(v).filter((r) => r.kind === kind && r.digest === d);
  return at.some((r) => r.outcome === "pass") && !at.some((r) => r.outcome === "block");
};
const passing = (v) => ["verify", "review", "decision"].filter((k) => okAt(v, k, v.dgst)).length;

export const state = (v) => {
  if (v.landed.h !== "none") {
    const good = v.landed.v === "pass" && v.landed.dv === "pass" && v.landed.rv === "pass";
    return good ? "Merged on a judged patch" : "Merged on an unjudged patch";
  }
  if (v.lastEval.h !== "none") {
    if (!v.lastEval.ready) return "Gate evaluated: blocked";
    if (v.lastEval.d !== v.dgst) return "Gate ready, but the patch digest moved since";
    return "Gate ready on the current patch";
  }
  return `No evaluation: ${passing(v)} of 3 verdict kinds pass on the current patch`;
};

export const group = (v) =>
  v.landed.h !== "none" ? "merged" : v.lastEval.h !== "none" && v.lastEval.ready ? "ready" : "open";

export const colors = { open: "blue", ready: "orange", merged: "teal" };

export const step = (action, from, to) =>
  ({
    RecordVerdict: "a verdict is recorded",
    PushCode: "code push (head and digest move)",
    PushEvidence: "evidence-only push (head moves)",
    BaseMoveBenign: "default branch moves, digest kept",
    BaseMoveInteracting: "default branch moves, digest changes",
    Evaluate: "mergeReadiness evaluates",
    ExecuteMergeGithub: "mergeThroughGithub merges",
  })[action] ?? action;
