import { findRoute, index, type RouteResult } from "./routes.ts";
import { UpstreamError } from "./upstream.ts";
import { BadRequest } from "./validate.ts";

export interface Env {
  /** Comma-separated exact origins allowed to read responses in a browser. */
  ALLOWED_ORIGINS?: string;
  /** Workers Rate Limiting binding (see wrangler.toml). Optional in local tests. */
  LIMITER?: RateLimit;
}

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return { Vary: "Origin" };
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...BASE_HEADERS, ...headers },
  });
}

const error = (status: number, code: string, message: string, headers: Record<string, string>) =>
  json(status, { error: { code, message } }, { "Cache-Control": "no-store", ...headers });

export async function handle(req: Request, env: Env, exec?: ExecutionContext): Promise<Response> {
  const cors = corsHeaders(req, env);
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    if (!cors["Access-Control-Allow-Origin"]) return new Response(null, { status: 403, headers: { ...BASE_HEADERS, ...cors } });
    return new Response(null, {
      status: 204,
      headers: { ...BASE_HEADERS, ...cors, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Max-Age": "86400" },
    });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return error(405, "method_not_allowed", "Only GET is supported.", { ...cors, Allow: "GET, HEAD, OPTIONS" });
  }

  if (env.LIMITER) {
    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.LIMITER.limit({ key: ip });
    if (!success) return error(429, "rate_limited", "Too many requests; slow down.", { ...cors, "Retry-After": "60" });
  }

  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  try {
    let result: RouteResult;
    if (pathname === "/" || pathname === "/v1") {
      result = index();
    } else {
      const found = findRoute(pathname);
      if (!found) return error(404, "not_found", "Unknown route. GET /v1 lists them.", cors);
      result = await found.route.handle({ params: found.params, query: url.searchParams, exec });
    }
    return json(200, result.body, {
      ...cors,
      "Cache-Control": `public, max-age=${Math.min(result.ttl, 300)}`,
      "X-Cache": result.cached ? "HIT" : "MISS",
    });
  } catch (err) {
    if (err instanceof BadRequest) return error(400, "bad_request", err.message, cors);
    if (err instanceof UpstreamError) return error(err.status, err.code, err.message, cors);
    console.error("unhandled", err instanceof Error ? err.message : String(err));
    return error(500, "internal_error", "Something went wrong.", cors);
  }
}

export default {
  fetch: (req, env, ctx) => handle(req, env, ctx),
} satisfies ExportedHandler<Env>;
