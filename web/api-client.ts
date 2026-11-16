import { optional } from "web/dom.ts";
import { type Account, RequestError } from "web/types.ts";

// Owns the API endpoint and the staff token persisted by this browser.
export class ApiClient {
  readonly apiBase =
    (optional<HTMLMetaElement>('meta[name="credit-cards-api"]')?.content ?? "")
      .replace(/\/$/, "");
  readonly storageKey = `credit-cards:staff:${
    this.apiBase.length > 0 ? this.apiBase : location.origin
  }`;
  private sessionToken: string | null = null;
  constructor(private readonly onUnauthorized: () => void) {
    try {
      this.sessionToken = localStorage.getItem(this.storageKey);
    } catch { /* Memory-only session if browser storage is disabled. */ }
  }
  readonly apiUrl = (path: string) => `${this.apiBase}${path}`;
  readonly saveToken = (token: string | null) => {
    this.sessionToken = token;
    try {
      if (token !== null && token.length > 0) {
        localStorage.setItem(this.storageKey, token);
      } else localStorage.removeItem(this.storageKey);
    } catch { /* Continue for this tab. */ }
  };

  readonly api = async <T = Account>(
    path: string,
    body?: object,
  ): Promise<T> => {
    const response = await fetch(
      this.apiUrl(path),
      {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        credentials: "omit",
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(this.sessionToken !== null && this.sessionToken.length > 0
            ? { Authorization: `Bearer ${this.sessionToken}` }
            : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== "/api/login") {
        this.saveToken(null);
        this.onUnauthorized();
      }
      const message =
        typeof result.error === "string" && result.error.length > 0
          ? result.error
          : "Unable to complete the request.";
      const error = new RequestError(
        message,
        response.status,
      );
      throw error;
    }
    return result;
  };

  acceptStoredToken(token: string | null) {
    this.sessionToken = token;
  }
}
