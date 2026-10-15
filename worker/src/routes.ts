// Route table: every public, unauthenticated, read-only colonist.io endpoint we
// found in their client, exposed under /v1. Nothing else is reachable, so this
// is not an open proxy.

import { upstream } from "./upstream.ts";
import * as v from "./validate.ts";

export interface RouteResult {
  body: unknown;
  /** Seconds browsers/CDNs may cache the response. */
  ttl: number;
  cached: boolean;
}

interface Ctx {
  params: string[]; // captured path segments
  query: URLSearchParams;
  exec?: ExecutionContext;
}

interface Route {
  path: string; // documentation form, e.g. /v1/players/:name/history
  match: RegExp;
  upstream: string; // documentation: colonist endpoint(s) behind it
  description: string;
  handle: (c: Ctx) => Promise<RouteResult>;
}

const TTL = { seasons: 6 * 3600, modes: 3600, championship: 3600, tabs: 3600, leaderboard: 300, player: 120, ranked: 300, items: 3600 };

type Season = { seasonType: number; name?: { options?: { seasonNumber?: number } } };

async function currentSeasonType(exec?: ExecutionContext): Promise<number> {
  const { data } = await upstream<Season[]>("/api/profile/ranked-seasons", TTL.seasons, exec);
  const first = Array.isArray(data) ? data[0]?.seasonType : undefined;
  if (typeof first !== "number") throw new v.BadRequest("Could not determine the current season; pass a seasonType.");
  return first;
}

const enc = encodeURIComponent;
const SEG = "([^/]+)";

export const ROUTES: Route[] = [
  {
    path: "/v1/seasons",
    match: /^\/v1\/seasons$/,
    upstream: "/api/profile/ranked-seasons",
    description: "All ranked seasons, newest first: season number and seasonType id.",
    handle: async ({ exec }) => {
      const r = await upstream("/api/profile/ranked-seasons", TTL.seasons, exec);
      return { body: r.data, ttl: TTL.seasons, cached: r.cached };
    },
  },
  {
    path: "/v1/modes",
    match: /^\/v1\/modes$/,
    upstream: "/api/mode-selector",
    description: "Game modes offered by matchmaking (bots, casual, ranked), with player counts and typical length in minutes.",
    handle: async ({ exec }) => {
      const r = await upstream<{ tabs?: unknown; gamesToUnlockRanked?: number }>("/api/mode-selector", TTL.modes, exec);
      // Drop the anonymous-session fields (isLoggedIn, rankedStates); they describe our proxy, not anyone real.
      return { body: { gamesToUnlockRanked: r.data.gamesToUnlockRanked, tabs: r.data.tabs }, ttl: TTL.modes, cached: r.cached };
    },
  },
  {
    path: "/v1/championship/:edition",
    match: /^\/v1\/championship\/(\d+)$/,
    upstream: "/api/championship{25|26}/content",
    description: "Colonist Championship content: qualifier events (date, title, location, join link) and partners. edition = 25 or 26.",
    handle: async ({ params, exec }) => {
      const ed = v.championshipEdition(params[0]);
      const r = await upstream(`/api/championship${ed}/content`, TTL.championship, exec);
      return { body: r.data, ttl: TTL.championship, cached: r.cached };
    },
  },
  {
    path: "/v1/leaderboards/:mode/tabs",
    match: new RegExp(`^/v1/leaderboards/${SEG}/tabs$`),
    upstream: "/api/leaderboards-tabs/{modeIndex}",
    description: "Active ranked modes and the current season's dates.",
    handle: async ({ params, exec }) => {
      const m = v.mode(params[0]);
      const r = await upstream(`/api/leaderboards-tabs/${v.LEADERBOARD_MODES[m]}`, TTL.tabs, exec);
      return { body: r.data, ttl: TTL.tabs, cached: r.cached };
    },
  },
  {
    path: "/v1/leaderboards/:mode/search",
    match: new RegExp(`^/v1/leaderboards/${SEG}/search$`),
    upstream: "/api/leaderboards-username-search/{mode}/{tab}?usernameSearchInput=",
    description: "Find players on a leaderboard by name. Query: q (2-40 chars), optional country=XX or continent=XX.",
    handle: async ({ params, query, exec }) => {
      const m = v.mode(params[0]);
      const t = v.tab(query);
      const q = v.searchTerm(query);
      const r = await upstream(`/api/leaderboards-username-search/${m}/${t}?usernameSearchInput=${enc(q)}`, TTL.leaderboard, exec, {
        emptyOnNoEntries: true,
      });
      return { body: r.data, ttl: TTL.leaderboard, cached: r.cached };
    },
  },
  {
    path: "/v1/leaderboards/:mode",
    match: new RegExp(`^/v1/leaderboards/${SEG}$`),
    upstream: "/api/leaderboards/{mode}/{tab}?start=&end=",
    description: "Leaderboard page. Query: start (1-based rank, default 1), limit (1-100, default 100), optional country=XX or continent=AF|AN|AS|EU|NA|OC|SA.",
    handle: async ({ params, query, exec }) => {
      const m = v.mode(params[0]);
      const t = v.tab(query);
      const start = v.intParam(query, "start", 1, 1, 1_000_000);
      const limit = v.intParam(query, "limit", 100, 1, 100);
      const r = await upstream(`/api/leaderboards/${m}/${t}?start=${start}&end=${start + limit - 1}`, TTL.leaderboard, exec);
      return { body: r.data, ttl: TTL.leaderboard, cached: r.cached };
    },
  },
  {
    path: "/v1/players/:name",
    match: new RegExp(`^/v1/players/${SEG}$`),
    upstream: "/api/profile/{name}/overview + /api/profile/{name}/sticky-player-info",
    description: "Player overview: user id, karma, lifetime games, win % and points over the last 100 games, country and icon.",
    handle: async ({ params, exec }) => {
      const n = enc(v.username(params[0]));
      const [overview, info] = await Promise.all([
        upstream<Record<string, unknown>>(`/api/profile/${n}/overview`, TTL.player, exec),
        upstream<Record<string, unknown>>(`/api/profile/${n}/sticky-player-info`, TTL.player, exec),
      ]);
      const { isLoggedIn: _ignored, ...profile } = info.data; // reflects our anonymous request, not the player
      return { body: { ...overview.data, ...profile }, ttl: TTL.player, cached: overview.cached && info.cached };
    },
  },
  {
    path: "/v1/players/:name/history",
    match: new RegExp(`^/v1/players/${SEG}/history$`),
    upstream: "/api/profile/{name}/history",
    description: "The player's last 100 games: settings, every player's color, play order, placement and VP, turn count and duration.",
    handle: async ({ params, exec }) => {
      const r = await upstream(`/api/profile/${enc(v.username(params[0]))}/history`, TTL.player, exec);
      return { body: r.data, ttl: TTL.player, cached: r.cached };
    },
  },
  {
    path: "/v1/players/:name/ranked/:seasonType?",
    match: new RegExp(`^/v1/players/${SEG}/ranked(?:/${SEG})?$`),
    upstream: "/api/profile/{name}/ranked/{seasonType}",
    description: "Per-mode ranked stats for a season: rating, division, win rate, games, global/continent/country/region rank. Defaults to the current season.",
    handle: async ({ params, exec }) => {
      const n = enc(v.username(params[0]));
      const season = params[1] ? v.seasonType(params[1]) : await currentSeasonType(exec);
      const r = await upstream(`/api/profile/${n}/ranked/${season}`, TTL.ranked, exec);
      return { body: { seasonType: season, modes: r.data }, ttl: TTL.ranked, cached: r.cached };
    },
  },
  {
    path: "/v1/players/:name/items",
    match: new RegExp(`^/v1/players/${SEG}/items$`),
    upstream: "/api/profile/{name}/items",
    description: "Cosmetic items the player owns (colors, icons, etc.).",
    handle: async ({ params, exec }) => {
      const r = await upstream(`/api/profile/${enc(v.username(params[0]))}/items`, TTL.items, exec);
      return { body: r.data, ttl: TTL.items, cached: r.cached };
    },
  },
];

/** Not exposed: they need a colonist.io login or change state. */
export const EXCLUDED = [
  "/api/replay/* (requires login)",
  "/api/leaderboards/{mode}/Friends, /api/leaderboards-my-sticky-row-data (per-user, requires login)",
  "/api/profile/friends, /api/notifications, /api/user-state, /api/find-game-ranked-state (requires login)",
  "POST endpoints (profile edits, payments, reports, username validation): never proxied",
];

export function index(): RouteResult {
  return {
    body: {
      name: "colonist-analytics API",
      note: "Unofficial, read-only proxy for colonist.io's public JSON endpoints. Responses are colonist.io's data, lightly cleaned.",
      routes: ROUTES.map(({ path, upstream: up, description }) => ({ path, upstream: up, description })),
      excluded: EXCLUDED,
    },
    ttl: 3600,
    cached: false,
  };
}

export function findRoute(pathname: string): { route: Route; params: string[] } | null {
  for (const route of ROUTES) {
    const m = route.match.exec(pathname);
    if (m) return { route, params: m.slice(1).filter((x) => x !== undefined) };
  }
  return null;
}
