// Loads the static snapshot written by scripts/crawl.mjs.

export interface Seat {
  order: number; // 1-based play order, 0 if unknown
  color: number;
  rank: number; // finishing position, 1 = winner
  points: number;
  quit: boolean;
  human: boolean;
}

export interface Game {
  id: string;
  t: number; // start, unix seconds
  dur: number; // seconds
  turns: number;
  gameType: number;
  queue: number; // eloType
  mode: number;
  map: number;
  dice: number;
  vp: number;
  private: boolean;
  seats: Seat[];
}

export interface LeaderboardRow {
  rank: number;
  username: string;
  country: string;
  continent: string;
  rating: number;
  winRate: number;
  games: number;
  division: number;
}

export interface PlayerSummary {
  u: string;
  n: number;
  w: number;
  vp: number;
  quits: number;
  seat: [number, number][]; // [games, wins] per 4P seat
  /** [t, eloType, rank, points, nPlayers, playOrder, turns] */
  recent: [number, number, number, number, number, number, number][];
  modes?: Record<string, { rank: number; rating: number }>;
  /** Per queue (eloType): [games, wins, sum of places, sum of VP] over the last 100 games. Added later; older snapshots lack it. */
  q?: Record<string, [number, number, number, number]>;
}

export interface Meta {
  generatedAt: string;
  topN: number;
  modes: string[];
  playersCrawled: number;
  gamesTotal: number;
  gamesAdded: number;
  retentionDays: number;
  season: { number: number; start: string; end: string } | null;
}

type RawGame = [string, number, number, number, number, number, number, number, number, number, number, number[][]];

const DATA_VERSION = 1;
const url = (file: string) => `${import.meta.env.BASE_URL}data/${file}`;

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(url(file), { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
  return res.json() as Promise<T>;
}

function decodeGame(r: RawGame): Game {
  return {
    id: r[0],
    t: r[1],
    dur: r[2],
    turns: r[3],
    gameType: r[4],
    queue: r[5],
    mode: r[6],
    map: r[7],
    dice: r[8],
    vp: r[9],
    private: r[10] === 1,
    seats: r[11].map((p) => ({
      order: p[0],
      color: p[1],
      rank: p[2],
      points: p[3],
      quit: p[4] === 1,
      human: p[5] === 1,
    })),
  };
}

const memo = new Map<string, Promise<unknown>>();
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!memo.has(key)) memo.set(key, load().catch((e) => (memo.delete(key), Promise.reject(e))));
  return memo.get(key) as Promise<T>;
}

export const loadMeta = () => once("meta", () => getJson<Meta>("meta.json"));

export const loadGames = () =>
  once("games", async () => {
    const raw = await getJson<{ v: number; games: RawGame[] }>("games.json");
    if (raw.v !== DATA_VERSION) throw new Error(`Unsupported data version ${raw.v}`);
    return raw.games.map(decodeGame);
  });

export const loadLeaderboards = () =>
  once("leaderboards", () => getJson<Record<string, LeaderboardRow[]>>("leaderboards.json"));

export const loadPlayers = () =>
  once("players", () => getJson<Record<string, PlayerSummary>>("players.json"));
