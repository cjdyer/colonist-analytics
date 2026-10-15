// Input validation for everything that ends up in an upstream URL. All values
// are also passed through encodeURIComponent, and upstream() re-checks the
// final path, but rejecting early gives clients a clear 400.

export class BadRequest extends Error {}

const USERNAME = /^[\p{L}\p{N}_#.\- ]{1,40}$/u;

export function username(raw: string): string {
  let v: string;
  try {
    v = decodeURIComponent(raw).trim();
  } catch {
    throw new BadRequest("Invalid username encoding.");
  }
  // "." and ".." would be resolved as path segments by URL parsing.
  if (!USERNAME.test(v) || /^\.+$/.test(v)) throw new BadRequest("Invalid username.");
  return v;
}

/** Leaderboard modes, mapped to colonist's numeric mode index (used by the tabs endpoint). */
export const LEADERBOARD_MODES: Record<string, number> = {
  Classic4P: 0,
  Classic1v1: 1,
  Seafarerers4P: 2, // sic: colonist's own spelling
  CitiesAndKnights4P: 3,
  Rush4P: 4,
};

export function mode(raw: string): string {
  if (!Object.hasOwn(LEADERBOARD_MODES, raw)) {
    throw new BadRequest(`Unknown mode. Use one of: ${Object.keys(LEADERBOARD_MODES).join(", ")}.`);
  }
  return raw;
}

const CONTINENTS = new Set(["AF", "AN", "AS", "EU", "NA", "OC", "SA"]);

/** Leaderboard tab path: "" (global), "Country/XX" or "Continent/XX". */
export function tab(q: URLSearchParams): string {
  const country = q.get("country");
  const continent = q.get("continent");
  if (country && continent) throw new BadRequest("Use either country or continent, not both.");
  if (country) {
    const c = country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) throw new BadRequest("country must be a 2-letter ISO code.");
    return `Country/${c}`;
  }
  if (continent) {
    const c = continent.toUpperCase();
    if (!CONTINENTS.has(c)) throw new BadRequest(`continent must be one of: ${[...CONTINENTS].join(", ")}.`);
    return `Continent/${c}`;
  }
  return "";
}

export function intParam(q: URLSearchParams, name: string, def: number, min: number, max: number): number {
  const raw = q.get(name);
  if (raw == null || raw === "") return def;
  if (!/^\d{1,7}$/.test(raw)) throw new BadRequest(`${name} must be an integer.`);
  const n = Number(raw);
  if (n < min || n > max) throw new BadRequest(`${name} must be between ${min} and ${max}.`);
  return n;
}

export function seasonType(raw: string): number {
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1) throw new BadRequest("seasonType must be a positive integer.");
  return Number(raw);
}

export function searchTerm(q: URLSearchParams): string {
  const v = (q.get("q") ?? "").trim();
  if (v.length < 2 || v.length > 40) throw new BadRequest("q must be 2-40 characters.");
  return v;
}

export function championshipEdition(raw: string): string {
  if (raw !== "25" && raw !== "26") throw new BadRequest("edition must be 25 or 26.");
  return raw;
}
