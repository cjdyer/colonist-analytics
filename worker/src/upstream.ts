// The only place that talks to colonist.io. Requests are anonymous (no client
// cookies or auth headers are ever forwarded), GET-only, size-limited and
// cached at the edge so repeated lookups don't reach colonist at all.

const ORIGIN = "https://colonist.io";
const UA = "colonist-analytics-api (read-only fan stats proxy)";
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 15_000;

export class UpstreamError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// colonist reports most failures as HTTP 400 with an i18n key; map the ones we
// understand to proper statuses.
function mapError(status: number, body: string): UpstreamError {
  let key = "";
  try {
    key = String(JSON.parse(body)?.error?.description?.key ?? "");
  } catch {
    /* non-JSON error body */
  }
  if (key.endsWith("noPlayerWithName")) return new UpstreamError(404, "player_not_found", "No player with that username.");
  if (key.endsWith("invalidSeason")) return new UpstreamError(400, "invalid_season", "Unknown season type.");
  if (key.endsWith("invalidRankedMode")) return new UpstreamError(400, "invalid_mode", "Unknown ranked mode.");
  if (key.endsWith("rangeTooBig") || key.endsWith("invalidApiParameters")) {
    return new UpstreamError(400, "invalid_range", "Invalid leaderboard range.");
  }
  if (status === 401 || status === 403) return new UpstreamError(502, "upstream_auth_required", "That data requires a colonist.io login.");
  if (status === 429) return new UpstreamError(503, "upstream_rate_limited", "colonist.io is rate limiting; try again shortly.");
  return new UpstreamError(502, "upstream_error", `colonist.io returned ${status}.`);
}

export function upstreamUrl(path: string): URL {
  const url = new URL(path, ORIGIN);
  // Defence in depth: validation already rejects traversal, but never let a
  // crafted segment resolve outside colonist.io/api/.
  if (url.origin !== ORIGIN || !url.pathname.startsWith("/api/")) {
    throw new UpstreamError(400, "invalid_path", "Invalid upstream path.");
  }
  return url;
}

const edgeCache = (): Cache | undefined => (typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : undefined);

export interface Fetched<T> {
  data: T;
  cached: boolean;
}

/**
 * GET a colonist.io JSON endpoint. `emptyOnNoEntries` turns colonist's
 * "noEntries" 400 (an empty search) into an empty array.
 */
export async function upstream<T>(
  path: string,
  ttlSeconds: number,
  ctx?: ExecutionContext,
  opts: { emptyOnNoEntries?: boolean } = {},
): Promise<Fetched<T>> {
  const url = upstreamUrl(path);
  const cache = edgeCache();
  const key = new Request(url.toString(), { method: "GET" });

  const hit = await cache?.match(key);
  if (hit) return { data: (await hit.json()) as T, cached: true };

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: { "User-Agent": UA, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError(504, "upstream_unreachable", "colonist.io did not respond.");
  }

  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new UpstreamError(502, "upstream_too_large", "Upstream response too large.");
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new UpstreamError(502, "upstream_too_large", "Upstream response too large.");

  if (!res.ok) {
    if (opts.emptyOnNoEntries && res.status === 400 && text.includes("noEntries")) return { data: [] as T, cached: false };
    throw mapError(res.status, text);
  }
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
    // colonist serves its HTML app for unknown /api paths.
    throw new UpstreamError(502, "upstream_not_json", "colonist.io did not return JSON for that endpoint.");
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(502, "upstream_bad_json", "colonist.io returned invalid JSON.");
  }

  if (cache && ttlSeconds > 0) {
    const put = cache.put(
      key,
      new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlSeconds}` } }),
    );
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return { data, cached: false };
}
