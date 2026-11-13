export interface Account {
  id: string;
  name: string;
  balance: number;
  url: string;
  createdAt?: string;
}

export interface CreditOperation {
  accountId: string;
  delta: 1 | -1;
  requestId: string;
}

export interface Session {
  authenticated: boolean;
}

export interface LoginResponse extends Session {
  token: string;
  expiresAt: string;
}

export type Api = <T = Account>(path: string, body?: object) => Promise<T>;

export class RequestError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export function asError(value: unknown): RequestError {
  return value instanceof Error ? value : new RequestError(String(value));
}
