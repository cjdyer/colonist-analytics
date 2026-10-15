import type { Game, Seat } from "./data";

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

/** Winner's VP minus the runner-up's, per game. */
export function margins(games: Game[]): number[] {
  const out: number[] = [];
  for (const g of games) {
    const win = g.seats.find((s) => s.rank === 1), second = g.seats.find((s) => s.rank === 2);
    if (win && second) out.push(win.points - second.points);
  }
  return out;
}

/** Average VP and share of games within one VP of the winner, per finishing place. */
export function vpByPlace(games: Game[], players: number) {
  const rows = Array.from({ length: players }, (_, i) => ({ place: i + 1, n: 0, vp: 0, close: 0 }));
  for (const g of games) {
    if (g.seats.length !== players) continue;
    const top = g.seats.find((s) => s.rank === 1)?.points ?? 0;
    for (const s of g.seats) {
      const r = rows[s.rank - 1];
      if (!r) continue;
      r.n++;
      r.vp += s.points;
      if (s.rank > 1 && top - s.points <= 1) r.close++;
    }
  }
  return rows;
}

/** Lower bound of the 95% Wilson interval: ranks win rates by how sure we are. */
export const wilsonLow = (wins: number, n: number) => (n ? Math.max(0, wins / n - ci95(wins, n)) : 0);
