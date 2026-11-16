export function shell() {
  return [
    <header className="topbar">
      <a className="brand" href="#/">
        <span className="brand-mark">C</span> Credit Cards
      </a>
      <span className="tag">A little credit goes a long way.</span>
    </header>,
    <main id="app">
      <p className="loading" {...{ role: "status" }}>Loading your accounts…</p>
    </main>,
    <div id="message" {...{ role: "status" }} aria-live="polite" hidden />,
    <dialog
      id="sync-dialog"
      aria-labelledby="sync-title"
      aria-describedby="sync-error"
    >
      <h2 id="sync-title">Could not sync</h2>
      <p id="sync-error" />
      <div className="sync-actions">
        <button id="sync-later" className="button secondary">Later</button>
        <button id="sync-retry" className="button primary">Retry</button>
      </div>
      <a
        id="sync-sign-in"
        className="back-link"
        href="#/login?returnTo=%2Fscan"
      >
        Staff sign in
      </a>
    </dialog>,
    <section id="print-cards" aria-label="Printable account cards" />,
    <footer>Scan a card. Check a balance. Keep things moving.</footer>,
  ];
}
