import type { Game, PlayerSummary, Seat } from "./data";

export interface Filters {
  queue: number | "all";
  days: number; // 0 = all time
  noQuitters: boolean;
}

export function filterGames(games: Game[], f: Filters, now = Date.now() / 1000): Game[] {
  const since = f.days > 0 ? now - f.days * 86400 : 0;
  return games.filter(
    (g) =>
      (f.queue === "all" || g.queue === f.queue) &&
      g.t >= since &&
      (!f.noQuitters || !g.seats.some((s) => s.quit)),
  );
}

export interface Bucket {
  key: number;
  games: number;
  wins: number;
  /** Sum of 1/players over the games: the win count a fair coin would give. */
  expected: number;
  vp: number;
  finish: number;
}

/** Aggregates per-seat outcomes, keyed by any seat attribute (order, color, ...). */
export function bucketSeats(games: Game[], key: (s: Seat, g: Game) => number | null): Bucket[] {
  const map = new Map<number, Bucket>();
  for (const g of games) {
    for (const s of g.seats) {
      const k = key(s, g);
      if (k == null) continue;
      let b = map.get(k);
      if (!b) map.set(k, (b = { key: k, games: 0, wins: 0, expected: 0, vp: 0, finish: 0 }));
      b.games++;
      if (s.rank === 1) b.wins++;
      b.expected += 1 / g.seats.length;
      b.vp += s.points;
      b.finish += s.rank;
    }
  }
  return [...map.values()].sort((a, b) => a.key - b.key);
}

export const winRate = (b: Bucket) => (b.games ? b.wins / b.games : 0);
export const expectedRate = (b: Bucket) => (b.games ? b.expected / b.games : 0);
export const delta = (b: Bucket) => winRate(b) - expectedRate(b);

/** Half-width of the 95% Wilson interval, in rate units. */
export function ci95(wins: number, n: number): number {
  if (!n) return 0;
  const z = 1.96, p = wins / n;
  const denom = 1 + (z * z) / n;
  return (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
}

/** Lolalytics-style tier from the win-rate delta vs. expected (percentage points). */
export function tier(b: Bucket, minGames: number): string {
  if (b.games < minGames) return "–";
  // Inside the 95% interval the difference is indistinguishable from noise.
  if (Math.abs(delta(b)) < ci95(b.wins, b.games)) return "B";
  const d = delta(b) * 100;
  if (d >= 4) return "S+";
  if (d >= 2) return "S";
  if (d >= 0.75) return "A";
  if (d > -0.75) return "B";
  if (d > -2) return "C";
  return "D";
}

export function histogram(values: number[], width: number, min: number, max: number) {
  const bins: { from: number; to: number; count: number }[] = [];
  for (let from = min; from < max; from += width) bins.push({ from, to: from + width, count: 0 });
  for (const v of values) {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor((v - min) / width)));
    if (bins[i]) bins[i].count++;
  }
  return bins;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// --- Live lookup -----------------------------------------------------------
// Mirrors summarisePlayer() in scripts/crawl.mjs, for live player pages.

interface RawHistory {
  profileUserId?: string;
  gameDatas?: {
    finished?: boolean;
    startTime?: string;
    turnCount?: number;
    setting?: { eloType?: number };
    players?: { userId?: string; username?: string; rank?: number; points?: number; playOrder?: number | null; quitWithPenalty?: boolean }[];
  }[];
}

export function summariseHistory(username: string, raw: RawHistory): PlayerSummary {
  const seat: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  let n = 0, w = 0, vp = 0, quits = 0;
  const recent: PlayerSummary["recent"] = [];
  for (const g of raw.gameDatas ?? []) {
    const players = g.players ?? [];
    const me = players.find((p) => String(p.userId) === String(raw.profileUserId));
    if (!g.finished || !me) continue;
    n++;
    const won = me.rank === 1;
    if (won) w++;
    vp += Number(me.points) || 0;
    if (me.quitWithPenalty) quits++;
    const o = Number(me.playOrder) || 0;
    if (o >= 1 && o <= 4 && players.length === 4) {
      seat[o - 1][0]++;
      if (won) seat[o - 1][1]++;
    }
    recent.push([
      Math.round((Number(g.startTime) || 0) / 1000),
      Number(g.setting?.eloType) || 0,
      Number(me.rank) || 0,
      Number(me.points) || 0,
      players.length,
      o,
      Number(g.turnCount) || 0,
    ]);
  }
  recent.sort((a, b) => b[0] - a[0]);
  return { u: username, n, w, vp, quits, seat, recent: recent.slice(0, 20) };
}
