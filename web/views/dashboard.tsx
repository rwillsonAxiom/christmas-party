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
