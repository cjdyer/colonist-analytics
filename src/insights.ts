// Per-player insights, computed in the browser from a player's recent games.
// Both sources (the live history and the snapshot summary) are normalised to
// PlayerGame first; fields the snapshot lacks are optional.

import type { History, HistoryPlayer } from "./api";
import type { PlayerSummary } from "./data";
import { ci95 } from "./stats";

export interface PlayerGame {
  id: string;
  t: number; // start, unix seconds
  queue: number;
  players: number;
  rank: number; // finishing place, 1 = win
  vp: number;
  order: number; // 1-based seat, 0 if unknown
  turns: number;
  won: boolean;
  dur?: number; // seconds
  target?: number; // VP to win
  winnerVp?: number;
  runnerUpVp?: number;
  quit?: boolean;
  roster?: HistoryPlayer[];
}

const DELETED = "Deleted User";

export function fromHistory(h: History): PlayerGame[] {
  const out: PlayerGame[] = [];
  for (const g of h.gameDatas) {
    const me = g.players.find((p) => p.userId === h.profileUserId);
    if (!g.finished || !me) continue;
    const pts = g.players.map((p) => p.points).sort((a, b) => b - a);
    out.push({
      id: g.id,
      t: Math.round(Number(g.startTime) / 1000),
      queue: g.setting.eloType,
      players: g.players.length,
      rank: me.rank,
      vp: me.points,
      order: me.playOrder ?? 0,
      turns: g.turnCount,
      won: me.rank === 1,
      dur: Math.round(Number(g.duration) / 1000),
      target: g.setting.victoryPointsToWin,
      winnerVp: g.players.find((p) => p.rank === 1)?.points ?? pts[0],
      runnerUpVp: g.players.find((p) => p.rank === 2)?.points ?? pts[1],
      quit: me.quitWithPenalty,
      roster: g.players,
    });
  }
  return out.sort((a, b) => b.t - a.t);
}

export function fromSnapshot(p: PlayerSummary): PlayerGame[] {
  return p.recent
    .map(([t, queue, rank, vp, players, order, turns], i) => ({
      id: `s${i}`, t, queue, rank, vp, players, order, turns, won: rank === 1,
    }))
    .sort((a, b) => b.t - a.t);
}

// --- Tally ----------------------------------------------------------------

export interface Tally {
  n: number;
  w: number;
  /** Wins a coin-flip player would expect: sum of 1/players. */
  expected: number;
  place: number; // sum of finishing places
  vp: number;
}

export function record(games: PlayerGame[]): Tally {
  const r: Tally = { n: 0, w: 0, expected: 0, place: 0, vp: 0 };
  for (const g of games) {
    r.n++;
    if (g.won) r.w++;
    r.expected += 1 / g.players;
    r.place += g.rank;
    r.vp += g.vp;
  }
  return r;
}

export const rate = (r: Tally) => (r.n ? r.w / r.n : 0);
export const fair = (r: Tally) => (r.n ? r.expected / r.n : 0);
export const edge = (r: Tally) => rate(r) - fair(r);
/** True when the gap to the fair share is bigger than the 95% interval. */
export const significant = (r: Tally) => r.n >= 10 && Math.abs(edge(r)) > ci95(r.w, r.n);

export function streak(games: PlayerGame[]): { won: boolean; n: number } | null {
  if (!games.length) return null;
  const won = games[0].won;
  let n = 0;
  while (n < games.length && games[n].won === won) n++;
  return { won, n };
}

export function byQueue(games: PlayerGame[]) {
  const by = new Map<number, PlayerGame[]>();
  for (const g of games) by.set(g.queue, [...(by.get(g.queue) ?? []), g]);
  return [...by.entries()]
    .map(([queue, gs]) => ({
      queue,
      rec: record(gs),
      turns: gs.reduce((a, g) => a + g.turns, 0) / gs.length,
      last: gs[0].t,
    }))
    .sort((a, b) => b.rec.n - a.rec.n);
}

/** Finishing-place counts for the table size the player plays most. */
export function placements(games: PlayerGame[]) {
  const sizes = new Map<number, number>();
  for (const g of games) sizes.set(g.players, (sizes.get(g.players) ?? 0) + 1);
  const players = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 4;
  const counts = Array.from({ length: players }, () => 0);
  for (const g of games) if (g.players === players && g.rank >= 1 && g.rank <= players) counts[g.rank - 1]++;
  return { players, counts, n: counts.reduce((a, b) => a + b, 0) };
}

// --- Close games -----------------------------------------------------------

export function closeness(games: PlayerGame[]) {
  const scored = games.filter((g) => g.winnerVp != null && g.runnerUpVp != null && !g.quit);
  const losses = scored.filter((g) => !g.won);
  const wins = scored.filter((g) => g.won);
  const short = losses.map((g) => g.winnerVp! - g.vp);
  return {
    losses: losses.length,
    wins: wins.length,
    /** Losses where the player was one VP from the winner. */
    oneShort: short.filter((d) => d <= 1).length,
    twoShort: short.filter((d) => d <= 2).length,
    /** Wins where the runner-up was one VP behind. */
    clutch: wins.filter((g) => g.vp - g.runnerUpVp! <= 1).length,
    avgShort: short.length ? short.reduce((a, b) => a + b, 0) / short.length : 0,
  };
}

// --- Game length -----------------------------------------------------------

export type Pace = "Fast" | "Average" | "Long";
export const PACES: Pace[] = ["Fast", "Average", "Long"];

/** Splits games into thirds by turn count within each queue, so 1v1 and 4P
 *  games are compared to their own kind. */
export function byPace(games: PlayerGame[]): { pace: Pace; rec: Tally; turns: [number, number] }[] {
  const buckets = new Map<Pace, PlayerGame[]>(PACES.map((p) => [p, []]));
  const ranges = new Map<Pace, [number, number]>(PACES.map((p) => [p, [Infinity, 0]]));
  const by = new Map<number, PlayerGame[]>();
  for (const g of games) if (g.turns > 0) by.set(g.queue, [...(by.get(g.queue) ?? []), g]);
  for (const gs of by.values()) {
    if (gs.length < 6) continue;
    const sorted = [...gs].sort((a, b) => a.turns - b.turns);
    sorted.forEach((g, i) => {
      const pace = PACES[Math.min(2, Math.floor((i * 3) / sorted.length))];
      buckets.get(pace)!.push(g);
      const r = ranges.get(pace)!;
      r[0] = Math.min(r[0], g.turns);
      r[1] = Math.max(r[1], g.turns);
    });
  }
  return PACES.map((pace) => ({ pace, rec: record(buckets.get(pace)!), turns: ranges.get(pace)! }));
}

// --- Activity ----------------------------------------------------------------

/** Games by local weekday (Mon = 0) and hour. */
export function weekGrid(times: number[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const t of times) {
    const d = new Date(t * 1000);
    grid[(d.getDay() + 6) % 7][d.getHours()]++;
  }
  return grid;
}

export const DAY_PARTS = [
  { name: "Night", from: 0, to: 6 },
  { name: "Morning", from: 6, to: 12 },
  { name: "Afternoon", from: 12, to: 18 },
  { name: "Evening", from: 18, to: 24 },
];

export function byDayPart(games: PlayerGame[]) {
  return DAY_PARTS.map((p) => ({
    ...p,
    rec: record(games.filter((g) => {
      const h = new Date(g.t * 1000).getHours();
      return h >= p.from && h < p.to;
    })),
  }));
}

/** Games per local calendar day for the last `days` days, oldest first. */
export function perDay(games: PlayerGame[], days: number, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const out = Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return { day: d, games: 0, wins: 0 };
  });
  for (const g of games) {
    const d = new Date(g.t * 1000);
    d.setHours(0, 0, 0, 0);
    const i = Math.round((d.getTime() - start.getTime()) / 86400_000);
    if (i >= 0 && i < days) {
      out[i].games++;
      if (g.won) out[i].wins++;
    }
  }
  return out;
}

// --- Sessions and tilt -----------------------------------------------------

/** A new session starts after this much idle time between game ends and starts. */
export const SESSION_GAP = 45 * 60;

export function sessions(games: PlayerGame[]) {
  const asc = [...games].sort((a, b) => a.t - b.t);
  const list: PlayerGame[][] = [];
  let end = -Infinity;
  for (const g of asc) {
    if (g.t - end > SESSION_GAP || !list.length) list.push([]);
    list[list.length - 1].push(g);
    end = g.t + (g.dur ?? g.turns * 25);
  }

  const afterWin: PlayerGame[] = [], afterLoss: PlayerGame[] = [], afterTwoLosses: PlayerGame[] = [];
  const first: PlayerGame[] = [], late: PlayerGame[] = [];
  for (const s of list) {
    s.forEach((g, i) => {
      if (i === 0) first.push(g);
      if (i >= 3) late.push(g);
      if (i >= 1) (s[i - 1].won ? afterWin : afterLoss).push(g);
      if (i >= 2 && !s[i - 1].won && !s[i - 2].won) afterTwoLosses.push(g);
    });
  }
  const lengths = list.map((s) => s.length);
  return {
    count: list.length,
    avgGames: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0,
    longest: Math.max(0, ...lengths),
    afterWin: record(afterWin),
    afterLoss: record(afterLoss),
    afterTwoLosses: record(afterTwoLosses),
    first: record(first),
    late: record(late),
  };
}

// --- Opponents ---------------------------------------------------------------

export interface Rival {
  id: string;
  name: string;
  games: number;
  /** Games where the player finished above this opponent. */
  above: number;
  myWins: number;
  theirWins: number;
}

export function rivals(games: PlayerGame[], me: string): Rival[] {
  const by = new Map<string, Rival>();
  for (const g of games) {
    const self = g.roster?.find((p) => p.userId === me);
    if (!self) continue;
    for (const p of g.roster!) {
      if (p.userId === me || !p.isHuman || p.username === DELETED) continue;
      const r = by.get(p.userId) ?? { id: p.userId, name: p.username, games: 0, above: 0, myWins: 0, theirWins: 0 };
      r.games++;
      if (self.rank < p.rank) r.above++;
      if (self.rank === 1) r.myWins++;
      if (p.rank === 1) r.theirWins++;
      by.set(p.userId, r);
    }
  }
  return [...by.values()].sort((a, b) => b.games - a.games || b.above - a.above);
}

/** Per-seat records for one table size (4P by default). */
export function bySeat(games: PlayerGame[], players: number) {
  return Array.from({ length: players }, (_, i) =>
    record(games.filter((g) => g.players === players && g.order === i + 1)),
  );
}
