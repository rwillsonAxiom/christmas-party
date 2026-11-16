import { ScannerElement } from "web/views/scanner.tsx";
import { query } from "web/dom.ts";
import { asError } from "web/types.ts";
import { cardIdFromCode, type ScannedCode, startScanner } from "web/scanner.ts";
import {
  type AccountTarget,
  RecentTargets,
  ScanTargets,
} from "web/scan-targets.tsx";
import type { AccountCache } from "web/account-cache.ts";
import type { AccountPages } from "web/account-pages.tsx";
import { automaticSelectionCoverage } from "web/scan-selection.ts";
type Options = {
  accountCache: AccountCache;
  accounts: AccountPages;
  isAuthenticated: () => boolean;
  getPageVersion: () => number;
  enterScannerFullscreen: () => Promise<void>;
  updateFullscreenControl: () => void;
  syncFailure: (error: Error, retry: () => void | Promise<void>) => void;
};

function loadScanner() {
  return Promise.resolve({ startScanner, cardIdFromCode });
}

// Owns camera lifetime, QR selection, target expiry, and scanner-only lookups.
export class ScannerPage {
  private readonly app = query("#app");
  private camera: { stop: () => void } | undefined;
  private refreshTargets: (() => void) | undefined;
  private clearTargets: (() => void) | undefined;
  constructor(private readonly options: Options) {}
  readonly render = async () => {
    if (!this.options.isAuthenticated()) {
      location.replace("#/login?returnTo=%2Fscan");
      return;
    }
    document.body.classList.add("scanning");
    const version = this.options.getPageVersion();
    document.title = "Scan cards · Credit Cards";
    this.app.replaceChildren(new ScannerElement());
    query<HTMLButtonElement>("#scanner-fullscreen").onclick =
      this.options.enterScannerFullscreen;
    this.options.updateFullscreenControl();
    const video = query<HTMLVideoElement>("#camera-video");
    video.muted = true;
    const status = query<HTMLElement>("#camera-status");
    const error = query<HTMLElement>("#camera-error");
    const start = query<HTMLButtonElement>("#camera-start");
    const name = query<HTMLElement>("#person-name");
    const balance = query<HTMLElement>("#credit-value");
    let lastInvalidNotice = 0;
    let selectedId: string | undefined;
    let visible: AccountTarget[] = [];
    const recentTargets = new RecentTargets();
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const lookups = new Map<string, Promise<void>>();
    const retryAfter = new Map<string, number>();
    const targets = new ScanTargets(query<HTMLElement>("#qr-targets"), (id) => {
      if (visible.some((target) => target.accountId === id)) selectAccount(id);
    });
    const refreshTargets = () => {
      if (version !== this.options.getPageVersion()) return;
      targets.update(
        visible,
        selectedId,
        (id) => this.options.accountCache.get(id)?.name,
      );
      if (
        selectedId !== undefined &&
        this.options.accounts.activeAccount === undefined
      ) {
        const account = this.options.accountCache.get(selectedId);
        if (account !== undefined) {
          this.options.accounts.activeAccount = account;
          name.textContent = account.name;
          this.options.accounts.updateBalance();
        }
      }
    };
    this.refreshTargets = refreshTargets;
    const clearTargets = () => {
      clearTimeout(expiryTimer);
      recentTargets.clear();
      visible = [];
      targets.update(
        [],
        selectedId,
        (id) => this.options.accountCache.get(id)?.name,
      );
    };
    this.clearTargets = clearTargets;
    const scheduleExpiry = () => {
      clearTimeout(expiryTimer);
      const next = recentTargets.nextExpiry();
      if (next === undefined) return;
      expiryTimer = setTimeout(() => {
        if (version !== this.options.getPageVersion()) return;
        visible = recentTargets.current(Date.now());
        refreshTargets();
        scheduleExpiry();
      }, Math.max(0, next - Date.now()));
    };
    const loadAccount = (id: string): Promise<void> => {
      const pending = lookups.get(id);
      if (pending !== undefined) return pending;
      if (Date.now() < (retryAfter.get(id) ?? 0)) return Promise.resolve();
      const task = this.options.accountCache.refresh(id).then(() => {}).catch(
        (caught) => {
          if (version !== this.options.getPageVersion()) return;
          retryAfter.set(id, Date.now() + 5000);
          this.options.syncFailure(asError(caught), () => {
            retryAfter.delete(id);
            return loadAccount(id);
          });
        },
      ).finally(() => lookups.delete(id));
      lookups.set(id, task);
      return task;
    };
    const selectAccount = (id: string, automatic = false) => {
      if (
        version !== this.options.getPageVersion() ||
        query<HTMLDialogElement>("#sync-dialog").open
      ) return;
      if (!automatic) this.options.accounts.clearCooldown();
      if (id === selectedId) {
        if (!automatic && this.options.accounts.activeAccount !== undefined) {
          this.options.accounts.updateBalance();
        }
        return;
      }
      selectedId = id;
      if (automatic) this.options.accounts.cooldown();
      this.options.accounts.activeAccount = this.options.accountCache.get(id);
      if (this.options.accounts.activeAccount !== undefined) {
        name.textContent = this.options.accounts.activeAccount.name;
        this.options.accounts.updateBalance();
      } else {
        name.textContent = "Loading name…";
        balance.textContent = "\u2014";
        query<HTMLButtonElement>("#add").disabled = true;
        query<HTMLButtonElement>("#remove").disabled = true;
      }
      refreshTargets();
      void loadAccount(id);
      status.textContent =
        "Account selected. Tap another labelled QR code to switch.";
    };
    const onCodes = (codes: ScannedCode[]) => {
      if (version !== this.options.getPageVersion()) return;
      const detected = codes.flatMap((code) => {
        const id = cardIdFromCode(code.value);
        return id !== undefined ? [{ ...code, accountId: id }] : [];
      });
      recentTargets.observe(detected, Date.now());
      visible = recentTargets.current(Date.now());
      scheduleExpiry();
      error.textContent = "";
      if (
        codes.length > 0 && detected.length === 0 &&
        Date.now() - lastInvalidNotice > 3000
      ) {
        error.textContent = "That QR code is not an account card.";
        lastInvalidNotice = Date.now();
      }
      const ids = [...new Set(visible.map((target) => target.accountId))];
      if (ids.length > 1 && selectedId === undefined) {
        selectedId = undefined;
        this.options.accounts.activeAccount = undefined;
        name.textContent = "Tap a QR code";
        balance.textContent = "\u2014";
        query<HTMLButtonElement>("#add").disabled = true;
        query<HTMLButtonElement>("#remove").disabled = true;
      }
      // Only fresh detections can trigger a switch; centered cards need less coverage.
      const dominant =
        detected.filter((target) =>
          target.coverage >= automaticSelectionCoverage(target.center)
        )
          .sort((a, b) => b.coverage - a.coverage)[0];
      if (dominant !== undefined) selectAccount(dominant.accountId, true);
      else if (ids.length === 1 && selectedId === undefined) {
        selectAccount(ids[0], true);
      }
      for (const id of ids) {
        if (this.options.accountCache.get(id) === undefined) {
          void loadAccount(id);
        }
      }
      refreshTargets();
    };
    const showCameraError = (text: string) => {
      if (version !== this.options.getPageVersion()) return;
      clearTargets();
      error.textContent = text;
      start.hidden = false;
      start.disabled = false;
      this.camera = undefined;
      status.textContent = "Camera is off.";
    };
    const startCamera = async () => {
      start.hidden = true;
      start.disabled = true;
      error.textContent = "";
      status.textContent = "Opening camera…";
      try {
        const { startScanner } = await loadScanner();
        if (version !== this.options.getPageVersion()) return;
        const controller = await startScanner(
          video,
          onCodes,
          showCameraError,
          query<HTMLElement>(".camera-guide"),
        );
        if (version !== this.options.getPageVersion()) {
          controller.stop();
          return;
        }
        this.camera = {
          stop: () => {
            clearTargets();
            controller.stop();
          },
        };
        start.disabled = false;
        status.textContent = "Point the camera at a card’s QR code.";
      } catch (caught) {
        const failure = asError(caught);
        if (version !== this.options.getPageVersion()) return;
        showCameraError(
          failure.name === "NotAllowedError"
            ? "Camera access was denied. Allow camera access for this website in your browser settings, then retry."
            : failure.name === "NotFoundError"
            ? "No camera was found on this device."
            : failure.message,
        );
      }
    };
    start.onclick = startCamera;
    query<HTMLButtonElement>("#add").onclick = () =>
      this.options.accounts.changeCredit(1);
    query<HTMLButtonElement>("#remove").onclick = () =>
      this.options.accounts.changeCredit(-1);
    void this.options.accounts.checkAllAccounts();
    await startCamera();
  };
  refresh() {
    this.refreshTargets?.();
  }
  stopCamera() {
    this.camera?.stop();
  }
  dispose() {
    this.clearTargets?.();
    this.clearTargets = undefined;
    this.refreshTargets = undefined;
    this.camera?.stop();
    this.camera = undefined;
  }
}
