export type FetchCall = { method: string; url: string; body: unknown };
export type FakeResponse = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };

/**
 * A fetch for Octokit that answers from routes keyed "METHOD /path-regex" and records every call.
 * Unrouted requests get a 404.
 */
export function fakeFetch(routes: Record<string, (body: unknown) => FakeResponse>) {
  const calls: FetchCall[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const path = new URL(url).pathname;
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && new RegExp(`^${p}$`).test(path);
    });
    if (!key) return new Response(JSON.stringify({ message: `no route for ${method} ${path}` }), { status: 404, headers: { "content-type": "application/json" } });
    const r = routes[key]!(body);
    if (r.text !== undefined) return new Response(r.text, { status: r.status ?? 200, headers: { "content-type": "text/plain", ...r.headers } });
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } });
  };
  return { fetch, calls };
}

export type GraphqlCall = { operation: string; variables: Record<string, unknown> };

/**
 * A fetch that answers `POST /graphql` by operation name. Each handler gets the variables and returns
 * the `data` of the response. `operations` lists the calls in order, for asserting what was sent.
 */
export function fakeGraphql(handlers: Record<string, (variables: Record<string, unknown>) => unknown>, rest: Record<string, (body: unknown) => FakeResponse> = {}) {
  const operations: GraphqlCall[] = [];
  const { fetch, calls } = fakeFetch({
    ...rest,
    "POST /graphql": (body) => {
      const { query, variables = {} } = body as { query: string; variables?: Record<string, unknown> };
      const operation = /^\s*(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
      operations.push({ operation, variables });
      const handler = handlers[operation];
      if (!handler) return { json: { errors: [{ message: `no handler for ${operation}` }] } };
      return { json: { data: handler(variables) } };
    },
  });
  return { fetch, calls, operations };
}
