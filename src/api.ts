// Client for the live API (worker/). Configure with VITE_API_BASE at build
// time; in `npm run dev` it defaults to a local `wrangler dev` on :8787.
// When unset in production, the site falls back to the static snapshot.

const configured = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "");
export const API_BASE = configured || (import.meta.env.DEV ? "http://localhost:8787" : "");
export const apiEnabled = API_BASE !== "";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const memo = new Map<string, Promise<unknown>>();

async function get<T>(path: string): Promise<T> {
  if (!apiEnabled) throw new ApiError(0, "disabled", "Live API is not configured.");
  const cached = memo.get(path);
  if (cached) return cached as Promise<T>;
  const p = (async () => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(20000) });
    } catch {
      throw new ApiError(0, "network", "Couldn't reach the live API.");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? `Request failed (${res.status}).`);
    }
    return body as T;
  })();
  memo.set(path, p);
  // Keep successes for 60s (the API caches upstream anyway); forget failures immediately.
  p.then(() => setTimeout(() => memo.delete(path), 60_000), () => memo.delete(path));
  return p;
}

const enc = encodeURIComponent;

// --- Types: the subset of colonist.io's payloads the UI reads. -------------

export type I18n = string | { key: string; options?: Record<string, unknown> };

export interface Season {
  seasonType: number;
  name: I18n;
}

export interface LiveLeaderboardRow {
  rank: number;
  division: number;
  subdivision: number;
  username: string;
  continentCode: string;
  countryCode: string;
  skillRating: number;
  winRate: number;
  totalGamesPlayed: number;
}

export interface PlayerProfile {
  userId: string;
  username: string;
  karma: string;
  country?: string;
  iconImageId?: number | null;
  gameData: { pointsInLast100Games: number; totalGames: number; winPercent: string; pointsPerGame: string };
}

export interface DivisionBoundary {
  division: number;
  subdivision: number;
  boundary: number;
}

export interface RankedMode {
  modeName: string;
  modeType: number;
  division: number;
  subdivision: number;
  winRate: string;
  gamesPlayed: string;
  skillRating: string;
  rankedStanding?: { name: I18n; rank: string }[];
  isLiveSeasonMode?: boolean;
  currentRankedState?: {
    type: number;
    numberOfPlacementGamesFinished?: number;
    numberOfPlacementGamesRequired?: number;
    currentDivisionState?: { promotionDivisionBoundary?: DivisionBoundary; demotionDivisionBoundary?: DivisionBoundary };
  };
}

export interface HistoryPlayer {
  userId: string;
  username: string;
  rank: number;
  points: number;
  finished: boolean;
  quitWithPenalty: boolean;
  isHuman: boolean;
  playerColor: number;
  playOrder: number | null;
}

export interface HistoryGame {
  id: string;
  setting: { gameType: number; eloType: number; modeSetting: number; mapSetting: number; diceSetting: number; victoryPointsToWin: number; privateGame: boolean; maxPlayers: number };
  finished: boolean;
  turnCount: number;
  startTime: string;
  duration: string;
  players: HistoryPlayer[];
  hasReplay: boolean;
}

export interface History {
  profileUserId: string;
  gameDatas: HistoryGame[];
}

export interface Item {
  category: number;
  type: number;
  name: I18n;
  price?: number;
  subscriptionOnly?: boolean;
}

export interface ModeCard {
  modeId: string;
  title: I18n;
  estimatedTime?: number;
  playerCount?: number;
  botCount?: number;
}

export interface Championship {
  partners?: { name: string; imageUrl?: string }[];
  qualifiers?: { date: string; title: string; joinUrl?: string; location?: string }[];
}

export type LeaderboardScope = { country?: string; continent?: string };
const scopeQuery = (s: LeaderboardScope) =>
  s.country ? `&country=${enc(s.country)}` : s.continent ? `&continent=${enc(s.continent)}` : "";

export const api = {
  seasons: () => get<Season[]>("/v1/seasons"),
  modes: () => get<{ gamesToUnlockRanked?: number; tabs: { tabId: string; cards: ModeCard[] }[] }>("/v1/modes"),
  championship: (edition: 25 | 26) => get<Championship>(`/v1/championship/${edition}`),
  leaderboard: (mode: string, start: number, scope: LeaderboardScope = {}, limit = 100) =>
    get<LiveLeaderboardRow[]>(`/v1/leaderboards/${enc(mode)}?start=${start}&limit=${limit}${scopeQuery(scope)}`),
  leaderboardSearch: (mode: string, q: string, scope: LeaderboardScope = {}) =>
    get<LiveLeaderboardRow[]>(`/v1/leaderboards/${enc(mode)}/search?q=${enc(q)}${scopeQuery(scope)}`),
  player: (name: string) => get<PlayerProfile>(`/v1/players/${enc(name)}`),
  history: (name: string) => get<History>(`/v1/players/${enc(name)}/history`),
  ranked: (name: string, seasonType?: number) =>
    get<{ seasonType: number; modes: RankedMode[] }>(`/v1/players/${enc(name)}/ranked${seasonType ? `/${seasonType}` : ""}`),
  items: (name: string) => get<Item[]>(`/v1/players/${enc(name)}/items`),
};

// --- Display helpers for colonist's i18n keys and enums. -------------------

const CONTINENTS: Record<string, string> = {
  AF: "Africa", AN: "Antarctica", AS: "Asia", EU: "Europe", NA: "North America", OC: "Oceania", SA: "South America",
};
export const CONTINENT_CODES = Object.keys(CONTINENTS);
export const continentName = (c: string) => CONTINENTS[c] ?? c;

/** Turns "strings:leaderboardPage.tabs.continents.OC" into "Oceania", "…tabs.global" into "Global". */
export function i18n(v: I18n | undefined): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  const last = v.key.split(".").pop() ?? v.key;
  if (CONTINENTS[last]) return CONTINENTS[last];
  if (v.options?.seasonNumber != null) return `Season ${v.options.seasonNumber}`;
  const words = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  return words;
}

const DIVISIONS = ["Grandmaster", "Master", "Diamond", "Platinum", "Gold", "Silver", "Bronze"];
const SUBDIVISIONS = ["I", "II", "III", "IV", "V"];
export function divisionName(division: number, subdivision?: number): string {
  const d = DIVISIONS[division];
  if (!d) return "Unranked";
  return division <= 1 || subdivision == null ? d : `${d} ${SUBDIVISIONS[subdivision] ?? ""}`.trim();
}
