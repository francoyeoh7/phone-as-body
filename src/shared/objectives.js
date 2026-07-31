export const OBJECTIVE_LABELS = Object.freeze({
  "find-fuse": "寻找备用保险丝",
  "restore-power": "将保险丝装入配电箱",
  "reach-elevator": "在它靠近前进入电梯",
  escaped: "离开 617",
});

const TRANSITIONS = Object.freeze({
  "find-fuse": { "fuse-collected": "restore-power" },
  "restore-power": { "panel-used": "reach-elevator" },
  "reach-elevator": { "elevator-entered": "escaped" },
  escaped: {},
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
        powerRestored: current === "reach-elevator" || current === "escaped",
        escaped: current === "escaped",
      };
    },
  };
}
