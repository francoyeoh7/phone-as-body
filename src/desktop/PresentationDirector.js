const FALLBACK_SLIDES = Object.freeze(Array.from({ length: 13 }, (_, index) => ({
  src: `/assets/presentation/slide-${String(index + 1).padStart(2, "0")}.png`,
  label: `Slide ${index + 1}`,
})));

function normalizeSlides(value) {
  const slides = Array.isArray(value?.slides) ? value.slides : [];
  return slides
    .map((slide, index) => ({
      src: typeof slide === "string" ? slide : slide?.src,
      label: typeof slide === "object" && slide?.label ? String(slide.label) : `Slide ${index + 1}`,
    }))
    .filter((slide) => typeof slide.src === "string" && slide.src.length > 0);
}

export class PresentationDirector {
  constructor({
    ui = null,
    phone = null,
    paper = null,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    manifestUrl = "/assets/presentation/manifest.json",
  } = {}) {
    this.ui = ui;
    this.phone = phone;
    this.paper = paper;
    this.fetchImpl = fetchImpl;
    this.manifestUrl = manifestUrl;
    this.slides = [];
    this.index = 0;
    this.opened = false;
    this.source = null;
    this.loading = null;
    this.destroyed = false;

    const controls = this.ui?.elements ?? {};
    controls.presentationPrevious?.addEventListener?.("click", () => this.previous());
    controls.presentationNext?.addEventListener?.("click", () => this.next());
    controls.presentationClose?.addEventListener?.("click", () => this.close());
  }

  isOpen() {
    return this.opened;
  }

  async loadManifest() {
    if (this.slides.length > 0) return this.slides;
    if (this.loading) return this.loading;
    this.loading = Promise.resolve().then(async () => {
      try {
        const response = await this.fetchImpl?.(this.manifestUrl);
        if (response?.ok) {
          const manifest = await response.json();
          this.slides = normalizeSlides(manifest);
        }
      } catch {
        // The bundled fallback keeps the deck usable when the manifest is
        // temporarily unavailable during a tunnel restart.
      }
      if (this.slides.length === 0) this.slides = [...FALLBACK_SLIDES];
      return this.slides;
    }).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  showPaper() {
    if (!this.paper) return false;
    this.paper.enabled = true;
    if (this.paper.root) this.paper.root.visible = true;
    return true;
  }

  hidePaper() {
    if (!this.paper) return false;
    this.paper.enabled = false;
    if (this.paper.root) this.paper.root.visible = false;
    return true;
  }

  sendState() {
    this.phone?.send?.({
      type: "presentation-state",
      active: this.opened,
      index: this.opened ? this.index : -1,
      total: this.slides.length,
      source: this.source,
    });
  }

  render() {
    if (!this.opened || this.slides.length === 0) return false;
    const slide = this.slides[this.index];
    this.ui?.setPresentation?.({
      active: true,
      index: this.index,
      total: this.slides.length,
      src: slide.src,
      label: slide.label,
    });
    // Keep adjacent images warm without decoding the entire deck at once.
    if (typeof Image !== "undefined") {
      for (const offset of [-1, 1]) {
        const next = this.slides[(this.index + offset + this.slides.length) % this.slides.length];
        if (next) {
          const image = new Image();
          image.src = next.src;
        }
      }
    }
    this.sendState();
    return true;
  }

  async open({ source = "settings" } = {}) {
    if (this.destroyed) return false;
    await this.loadManifest();
    if (this.slides.length === 0) return false;
    this.source = source;
    this.index = 0;
    this.opened = true;
    this.hidePaper();
    this.render();
    return true;
  }

  next() {
    if (!this.opened || this.slides.length === 0) return false;
    if (this.slides.length === 1) return false;
    this.index = (this.index + 1) % this.slides.length;
    return this.render();
  }

  previous() {
    if (!this.opened || this.slides.length === 0) return false;
    if (this.slides.length === 1) return false;
    this.index = (this.index - 1 + this.slides.length) % this.slides.length;
    return this.render();
  }

  close() {
    if (!this.opened) return false;
    this.opened = false;
    this.source = null;
    this.ui?.setPresentation?.({ active: false });
    this.sendState();
    return true;
  }

  handleAction(action) {
    if (action === "presentation-open") return this.open({ source: "settings" });
    if (action === "presentation-next") return this.next();
    if (action === "presentation-prev") return this.previous();
    if (action === "presentation-close") return this.close();
    return false;
  }

  destroy() {
    this.destroyed = true;
    this.close();
    this.ui?.setPresentation?.({ active: false });
  }
}

export { FALLBACK_SLIDES, normalizeSlides };
