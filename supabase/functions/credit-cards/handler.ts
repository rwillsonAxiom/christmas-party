/** The only Supabase routing-specific adapter; the API is host-independent. */
export function hostedHandler(api: (request: Request) => Promise<Response>) {
  return (request: Request) => {
    const url = new URL(request.url);
    url.pathname =
      url.pathname.replace(/^\/(?:functions\/v1\/)?credit-cards(?=\/|$)/, "") ||
      "/";
    return api(new Request(url, request));
  };
}
