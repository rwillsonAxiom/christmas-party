export class ScannerElement extends HTMLElement {
  private rendered = false;
  connectedCallback() {
    // Reconnecting the same element must retain its live video and controls.
    if (this.rendered) return;
    this.rendered = true;
    this.replaceChildren(
      <section className="scanner-screen" aria-label="Card scanner">
        <div className="camera-frame">
          <video
            id="camera-video"
            autoplay
            muted
            playsInline
            aria-label="Live card scanner"
          />
          <div className="camera-guide" aria-hidden="true" />
          <div
            id="qr-targets"
            className="qr-targets"
            aria-label="Detected account cards"
          />
          <a
            href="#/"
            className="fullscreen-button scanner-exit"
            aria-label="Exit scanner"
            title="Exit scanner"
          >
            ×
          </a>
          <button
            type="button"
            id="scanner-fullscreen"
            className="fullscreen-button"
            aria-label="Enter fullscreen"
            title="Enter fullscreen"
            hidden
          >
            ⛶
          </button>
          <p id="camera-status" className="sr-only" {...{ role: "status" }}>
            Opening camera…
          </p>
          <div className="camera-feedback">
            <p id="camera-error" {...{ role: "alert" }} />
            <button
              type="button"
              id="camera-start"
              className="button primary"
              hidden
            >
              Retry camera
            </button>
          </div>
        </div>
        <section
          id="scan-result"
          className="scan-result"
          aria-label="Scanned account"
        >
          <h1 id="person-name">Scan a card</h1>
          <p
            id="credit-value"
            className="credit-value"
            aria-label="Available credits"
            aria-live="polite"
          >
            —
          </p>
          <div className="credit-actions">
            <button
              type="button"
              id="remove"
              className="button secondary"
              aria-label="Remove one credit"
              disabled
            >
              −
            </button>
            <button
              type="button"
              id="add"
              className="button primary"
              aria-label="Add one credit"
              disabled
            >
              +
            </button>
          </div>
          <p id="change-status" className="sr-only" {...{ role: "status" }} />
        </section>
      </section>,
    );
  }
}

customElements.define("card-scanner", ScannerElement);
declare global {
  interface HTMLElementTagNameMap {
    "card-scanner": ScannerElement;
  }
}
