export function createWashbasinState({ onChange } = {}) {
  let running = false;

  const setRunning = (next) => {
    const value = Boolean(next);
    if (value === running) return running;
    running = value;
    onChange?.({ running });
    return running;
  };

  return {
    get running() {
      return running;
    },
    setRunning,
    toggle: () => setRunning(!running),
  };
}
