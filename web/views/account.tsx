export function account() {
  return [
    <a className="back-link" href="#/">← All accounts</a>,
    <div className="account-layout">
      <section className="balance-panel">
        <p className="eyebrow">YOU’RE LOOKING AT</p>
        <h1 id="person-name" />
        <p className="muted">Available credits</p>
        <p id="credit-value" className="credit-value" aria-live="polite" />
        <div className="credit-actions">
          <button id="remove" className="button secondary">
            \u2212 Remove 1
          </button>
          <button id="add" className="button primary">+ Add 1</button>
        </div>
        <p
          id="change-status"
          className="change-status"
          {...{ role: "status" }}
        />
        <button id="refresh" className="text-button">Refresh balance</button>
      </section>
      <aside className="card-preview">
        <div id="single-card" />
        <button id="print-one" className="button secondary">
          Print this card
        </button>
      </aside>
    </div>,
    <p className="access-note">
      Anyone with this card link can view the balance. Only signed-in staff can
      change credits.
    </p>,
  ];
}
