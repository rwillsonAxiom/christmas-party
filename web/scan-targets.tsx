import type { ScannedCode } from "./scanner.ts";

export interface AccountTarget extends ScannedCode {
  accountId: string;
}

// Reuse each button as its QR moves: replacing it every frame interrupts taps
// and keyboard focus. The four edges follow the decoder's actual quadrilateral.
export class ScanTargets {
  private readonly nodes = new Map<
    string,
    { button: HTMLButtonElement; label: HTMLElement; edges: HTMLElement[] }
  >();
  constructor(
    private readonly container: HTMLElement,
    private readonly select: (accountId: string) => void,
  ) {}

  update(
    targets: AccountTarget[],
    selected: string | undefined,
    name: (id: string) => string | undefined,
  ) {
    const seen = new Set<string>();
    const occurrences = new Map<string, number>();
    const sorted = [...targets].sort((a, b) =>
      a.value.localeCompare(b.value) || a.corners[0].x - b.corners[0].x ||
      a.corners[0].y - b.corners[0].y
    );
    for (const target of sorted) {
      const occurrence = occurrences.get(target.value) || 0;
      occurrences.set(target.value, occurrence + 1);
      const key = `${target.value}:${occurrence}`;
      seen.add(key);
      let node = this.nodes.get(key);
      if (!node) {
        const edges = Array.from(
          { length: 4 },
          () => <span className="qr-edge" aria-hidden="true" /> as HTMLElement,
        );
        const label = <span className="qr-name" /> as HTMLElement;
        const button = (
          <button type="button" className="qr-target" />
        ) as HTMLButtonElement;
        button.append(...edges, label);
        button.onclick = () =>
          this.select(target.accountId);
        node = { button, edges, label };
        this.nodes.set(key, node);
        this.container.append(button);
      }
      const { button, edges, label } = node;
      const accountName = name(target.accountId);
      label.textContent = accountName || "Loading name…";
      button.setAttribute(
        "aria-label",
        accountName ? `Select ${accountName}` : "Select account; name loading",
      );
      button.setAttribute(
        "aria-pressed",
        String(selected === target.accountId),
      );
      button.title = accountName || "Loading name…";
      button.classList.toggle("is-selected", selected === target.accountId);
      const xs = target.corners.map((p) => p.x),
        ys = target.corners.map((p) => p.y);
      const left = Math.min(...xs), top = Math.min(...ys);
      const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
      if (width <= 0 || height <= 0) {
        button.hidden = true;
        continue;
      }
      button.hidden = false;
      button.style.left = `${left * 100}%`;
      button.style.top = `${top * 100}%`;
      button.style.width = `${width * 100}%`;
      button.style.height = `${height * 100}%`;
      const centerX = left + width / 2;
      label.style.maxWidth = `min(160px, ${
        2 * Math.min(centerX, 1 - centerX) / width * 100
      }%)`;
      for (let i = 0; i < 4; i++) {
        const a = target.corners[i], b = target.corners[(i + 1) % 4];
        const dx = b.x - a.x, dy = b.y - a.y;
        edges[i].style.left = `${(a.x - left) / width * 100}%`;
        edges[i].style.top = `${(a.y - top) / height * 100}%`;
        edges[i].style.width = `${Math.hypot(dx, dy) / width * 100}%`;
        edges[i].style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      }
    }
    for (const [key, node] of this.nodes) {
      if (!seen.has(key)) {
        node.button.remove();
        this.nodes.delete(key);
      }
    }
  }
}
