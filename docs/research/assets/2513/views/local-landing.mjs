export const title = "Local landing (LocalLanding.tla)";

const judgedFact = (v) => v.judged.d !== "none";
const drift = (v) => {
  if (!judgedFact(v)) return "";
  const moved = [];
  if (v.patch !== v.judged.d) moved.push("patch changed");
  if (v.base !== v.judged.b) moved.push("base moved");
  return moved.length ? ` (${moved.join(", ")} since judgement)` : "";
};

export const state = (v) => {
  if (v.landed.d !== "none") {
    const ok = judgedFact(v) && v.judged.b === v.landed.b && v.judged.d === v.landed.d;
    return ok ? "Landed the judged patch" : "Landed an unjudged patch";
  }
  if (v.decided.d !== "none") return `Decided to land${drift(v)}`;
  if (v.commitReady) return judgedFact(v) ? `Commit built, judged${drift(v)}` : "Commit built, not judged";
  return judgedFact(v) ? `Judged${drift(v)}` : "Not judged";
};

export const group = (v) =>
  v.landed.d !== "none" ? "landed" : v.decided.d !== "none" ? "decided" : "open";

export const colors = { open: "blue", decided: "orange", landed: "teal" };

export const step = (action) =>
  ({
    JudgeLocalPatch: "judge patch",
    LocalPatchChange: "patch changes",
    LocalBaseMove: "default branch moves",
    CreateCommit: "build merge commit",
    DecideLocalMerge: "decideLocalMerge says land",
    LandLocal: "applyMergeLanding updates ref",
  })[action] ?? action;
