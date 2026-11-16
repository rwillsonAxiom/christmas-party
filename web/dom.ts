export function optional<T extends HTMLElement = HTMLElement>(
  selector: string,
): T | null {
  return document.querySelector<T>(selector);
}
export function query<T extends HTMLElement = HTMLElement>(
  selector: string,
): T {
  const node = optional<T>(selector);
  if (node === null) throw new Error(`Missing page element: ${selector}`);
  return node;
}

export function browserStorage(name: "localStorage" | "sessionStorage") {
  try {
    return globalThis[name];
  } catch {
    return undefined;
  }
}
