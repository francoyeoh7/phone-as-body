const VILLAGE_OBJECTIVE = "探索村庄。";

export class VillageDirector {
  constructor({ experience, ui, audio, inventory }) {
    this.experience = experience;
    this.ui = ui;
    this.audio = audio;
    this.inventory = inventory;
    this.settings = { subtitles: true };
    this.destroyed = false;
    this.ui?.setObjective?.(VILLAGE_OBJECTIVE);
  }

  setSettings(settings = {}) {
    this.settings = {
      ...this.settings,
      subtitles: typeof settings.subtitles === "boolean" ? settings.subtitles : this.settings.subtitles,
    };
    if (!this.settings.subtitles) this.ui?.setSubtitle?.(null, false);
  }

  handleInteraction(id) {
    if (this.destroyed) return false;
    if (id === "fuse") return this.collectFuse();
    if (id === "washbasin") return this.toggleWashbasin();
    return false;
  }

  collectFuse() {
    const fuse = this.experience?.objects?.fuse;
    if (!fuse?.enabled || !fuse?.root) return false;
    fuse.enabled = false;
    fuse.root.visible = false;
    this.inventory?.acquire?.("spare-fuse");
    this.ui?.setPrompt?.(null);
    this.ui?.setObjective?.(VILLAGE_OBJECTIVE);
    this.audio?.cue?.("pickup");
    return true;
  }

  toggleWashbasin() {
    const washbasin = this.experience?.objects?.washbasin;
    if (typeof washbasin?.toggle !== "function") return false;
    const running = washbasin.toggle();
    this.ui?.setPrompt?.(washbasin.label ?? null);
    this.audio?.cue?.(running ? "water-on" : "water-off");
    return true;
  }

  update() {}

  destroy() {
    this.destroyed = true;
    this.ui?.setSubtitle?.(null, false);
  }
}
