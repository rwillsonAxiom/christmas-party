import { optional } from "web/dom.ts";
export class ScannerFullscreen {
  private scannerOwnsFullscreen = false;
  constructor(private readonly route: () => URL) {
    document.addEventListener("fullscreenchange", this.update);
  }
  readonly update = () => {
    const button = optional<HTMLButtonElement>("#scanner-fullscreen");
    if (button !== null) {
      button.hidden = !document.fullscreenEnabled ||
        document.fullscreenElement !== null;
    }
  };

  readonly enter = async () => {
    if (!document.fullscreenEnabled || document.fullscreenElement !== null) {
      return;
    }
    try {
      await document.documentElement.requestFullscreen({
        navigationUI: "hide",
      });
      this.scannerOwnsFullscreen = true;
      if (this.route().pathname !== "/scan") await this.leave();
    } catch {
      /* Keep scanning in the available viewport if the browser declines. */
    }
    this.update();
  };

  readonly leave = async () => {
    if (!this.scannerOwnsFullscreen) return;
    this.scannerOwnsFullscreen = false;
    try {
      if (document.fullscreenElement !== null) await document.exitFullscreen();
    } catch { /* The browser may already have left fullscreen. */ }
  };
}
