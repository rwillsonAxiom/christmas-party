import { jsx } from "@reububble/jsx/jsx-runtime";

import type { Account } from "./types.ts";

// Use raw HTML attributes for `for` and `role`: the runtime sets attributes,
// while its intrinsic types omit these names in the DOM library used by Deno.

// This runtime returns native DOM nodes. Keep the live camera node mounted
// while account names, balances and button states change independently.
export function text(tag: string, className?: string, value?: string) {
  return jsx(tag, { className: className || "", children: value });
}

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

export function login() {
  return (
    <section className="panel login-panel">
      <p className="eyebrow">STAFF ACCESS</p>
      <h1>Sign in.</h1>
      <p>Enter the staff password to create accounts and adjust credits.</p>
      <form id="login-form">
        <label {...{ for: "password" }}>Staff password</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          maxLength={1024}
          required
        />
        <button className="button primary" type="submit">Sign in</button>
        <p id="login-error" className="inline-error" {...{ role: "alert" }} />
      </form>
      <a className="back-link" id="viewer-link">Continue as a viewer</a>
    </section>
  );
}

export function dashboard() {
  return [
    <section className="intro">
      <div>
        <p className="eyebrow">THE CREDIT DESK</p>
        <h1>
          Good people.<br />A little credit.
        </h1>
        <p className="lede">
          One card for each person. One simple way to keep track.
        </p>
      </div>
      <div className="intro-seal" aria-hidden="true">
        <span>SCAN</span>
        <b>+1</b>
        <span>AND GO</span>
      </div>
    </section>,
    <div className="dashboard-grid">
      <section className="panel create-panel">
        <p className="eyebrow">01 / SET SOMEONE UP</p>
        <h2>A name. A starting balance.</h2>
        <p>Create an account, then print their card.</p>
        <form id="create-form">
          <label {...{ for: "name" }}>Name</label>
          <input
            id="name"
            name="name"
            placeholder="e.g. Alex Morgan"
            maxLength={80}
            required
            autocomplete="off"
          />
          <label {...{ for: "balance" }}>Starting credits</label>
          <input
            id="balance"
            name="balance"
            type="number"
            min="0"
            max="1000000"
            step="1"
            value="0"
            required
          />
          <button className="button primary" type="submit">
            Create account <span aria-hidden="true">↗</span>
          </button>
          <p id="form-error" className="inline-error" {...{ role: "alert" }} />
        </form>
        <div className="small-note">
          Cards link to this website. Their balances stay up to date when
          credits change.
        </div>
      </section>
      <section className="panel accounts-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">02 / READY TO GO</p>
            <h2>
              Your accounts <span id="count" className="count">0</span>
            </h2>
          </div>
          <button id="print-all" className="button secondary" disabled>
            Print all cards
          </button>
        </div>
        <label className="sr-only" {...{ for: "search" }}>
          Search accounts
        </label>
        <input id="search" type="search" placeholder="Find a person…" />
        <div id="account-list" aria-live="polite">
          <p className="muted">Loading accounts…</p>
        </div>
      </section>
    </div>,
    <p className="access-note">
      Anyone can view balances. Signed-in staff can create accounts and change
      credits.
    </p>,
  ];
}

export function card(account: Account, qrUrl: string) {
  return (
    <article className="paper-card">
      <span className="eyebrow">YOUR CREDIT CARD</span>
      <h2 className="card-name">{account.name}</h2>
      <img
        className="qr"
        src={qrUrl}
        alt={`QR code for ${account.name}'s account`}
        width={220}
        height={220}
      />
      <p className="card-caption">Scan to view your credits</p>
      <small className="card-link">{account.url}</small>
    </article>
  );
}

export function accountRow(
  account: Account,
  staff: boolean,
  onPrint: () => void,
) {
  const row = (
    <article className="account-row">
      <span className="avatar" aria-hidden="true">
        {account.name.slice(0, 1).toUpperCase()}
      </span>
      <a className="account-name" href={`#/account/${account.id}`}>
        {account.name}
      </a>
      <span className="balance-pill">
        {`${account.balance.toLocaleString()} ${
          account.balance === 1 ? "credit" : "credits"
        }`}
      </span>
    </article>
  );
  if (staff) {
    row.append(
      <button className="text-button" onclick={onPrint}>Print card</button>,
    );
  }
  return row;
}

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
          <button id="remove" className="button secondary">− Remove 1</button>
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

export function scanner() {
  return (
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
        <a
          href="#/"
          className="fullscreen-button scanner-exit"
          aria-label="Exit scanner"
          title="Exit scanner"
        >
          ×
        </a>
        <button
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
          <button id="camera-start" className="button primary" hidden>
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
            id="remove"
            className="button secondary"
            aria-label="Remove one credit"
            disabled
          >
            −
          </button>
          <button
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
    </section>
  );
}
