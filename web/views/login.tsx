import { asError } from "web/types.ts";

export class LoginElement extends HTMLElement {
  returnTo = "/";
  signIn: ((password: string) => Promise<void>) | undefined;
  private rendered = false;

  connectedCallback() {
    if (this.rendered) return;
    this.rendered = true;
    this.replaceChildren(
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
      </section>,
    );
    this.querySelector<HTMLAnchorElement>("#viewer-link")!.href =
      `#${this.returnTo}`;
    this.querySelector<HTMLFormElement>("#login-form")!.addEventListener(
      "submit",
      this.submit,
    );
  }

  private readonly submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const button = form.querySelector("button")!;
    const error = this.querySelector<HTMLElement>("#login-error")!;
    button.disabled = true;
    error.textContent = "";
    try {
      await this.signIn?.(
        (form.elements.namedItem("password") as HTMLInputElement).value,
      );
      form.reset();
    } catch (caught) {
      error.textContent = asError(caught).message;
    } finally {
      button.disabled = false;
    }
  };
}

customElements.define("staff-login", LoginElement);
declare global {
  interface HTMLElementTagNameMap {
    "staff-login": LoginElement;
  }
}
