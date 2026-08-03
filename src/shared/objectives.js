export const OBJECTIVE_LABELS = Object.freeze({
  "find-fuse": "寻找备用保险丝",
  "restore-power": "将保险丝装入配电箱",
  "reach-door": "在它靠近前守住后门",
  secured: "后门已守住",
});

const TRANSITIONS = Object.freeze({
  "find-fuse": { "fuse-collected": "restore-power" },
  "restore-power": { "panel-used": "reach-door" },
  "reach-door": { "door-defended": "secured" },
  secured: {},
});

export function createObjectiveState(initial = "find-fuse") {
  if (!Object.hasOwn(TRANSITIONS, initial)) throw new Error("Invalid objective state");
  let current = initial;

  return {
    current: () => current,
    label: () => OBJECTIVE_LABELS[current],
    dispatch(event) {
      const next = TRANSITIONS[current][event];
      if (!next) return { accepted: false, reason: "out-of-order", current };
      const previous = current;
      current = next;
      return { accepted: true, event, previous, next, current };
    },
    serialize() {
      return {
        current,
        hasFuse: current !== "find-fuse",
        powerRestored: current === "reach-door" || current === "secured",
        secured: current === "secured",
      };
    },
  };
}
