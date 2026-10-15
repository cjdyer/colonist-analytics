#!/usr/bin/env node
// Snapshot crawler for colonist.io's public (unauthenticated) JSON endpoints.
//
// colonist.io does not send CORS headers, so the browser cannot call it from
// GitHub Pages. This script runs in GitHub Actions instead, and writes static
// JSON into public/data/ that the front-end reads.
//
//   1. GET /api/leaderboards/{mode}/?start=&end=   top N players per ranked mode
//   2. GET /api/profile/{username}/history          last 100 games per player
//   3. Merge games into the rolling dataset (deduped by game id, pruned by age)
//
// Usage: node scripts/crawl.mjs
// Env:   TOP_N (default 200), DELAY_MS (default 350), CONCURRENCY (default 2),
//        RETENTION_DAYS (default 60), MAX_GAMES (default 60000)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "data");
const BASE = "https://colonist.io/api";

const intEnv = (name, def, min, max) => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const TOP_N = intEnv("TOP_N", 200, 1, 2000);
const DELAY_MS = intEnv("DELAY_MS", 350, 100, 10000);
const CONCURRENCY = intEnv("CONCURRENCY", 2, 1, 4);
const RETENTION_DAYS = intEnv("RETENTION_DAYS", 60, 1, 365);
const MAX_GAMES = intEnv("MAX_GAMES", 60000, 1000, 500000);
const PAGE = 100; // the API rejects ranges wider than 100 rows

// Ranked leaderboard modes (from colonist's own client enum). Seafarers is
// listed in the client but has no active leaderboard.
const MODES = ["Classic4P", "Classic1v1", "CitiesAndKnights4P", "Rush4P"];

const UA = "colonist-analytics snapshot crawler (static fan site; low rate)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path, attempt = 0) {
  const res = await fetch(BASE + path, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  }).catch((err) => ({ ok: false, status: 0, err }));

  if (res.ok) return res.json();
  const retryable = res.status === 0 || res.status === 429 || res.status >= 500;
  if (retryable && attempt < 4) {
    const retryAfter = Number(res.headers?.get?.("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt + 1);
    await sleep(wait);
    return getJson(path, attempt + 1);
  }
  throw new Error(`GET ${path} -> ${res.status || res.err?.message}`);
}

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v, max = 64) => (typeof v === "string" ? v.slice(0, max) : "");

async function fetchLeaderboard(mode) {
  const rows = [];
  for (let start = 1; start <= TOP_N; start += PAGE) {
    const end = Math.min(start + PAGE - 1, TOP_N);
    const page = await getJson(`/leaderboards/${mode}/?start=${start}&end=${end}`);
    if (!Array.isArray(page) || page.length === 0) break;
    for (const r of page) {
      const username = str(r.username);
      if (!username) continue;
      rows.push({
        rank: num(r.rank),
        username,
        country: str(r.countryCode, 2),
        continent: str(r.continentCode, 2),
        rating: num(r.skillRating),
        winRate: Math.round(num(r.winRate) * 10) / 10,
        games: num(r.totalGamesPlayed),
        division: num(r.division),
      });
    }
    await sleep(DELAY_MS);
  }
  return rows;
}

// Compact positional encoding keeps games.json small. See src/data.ts for the
// matching decoder; bump DATA_VERSION if the shape changes.
const DATA_VERSION = 1;

function encodeGame(g) {
  const s = g?.setting ?? {};
  if (!g?.finished || !Array.isArray(g.players) || g.players.length < 2) return null;
  const players = g.players.map((p) => [
    num(p.playOrder), // 0 = unknown (older games)
    num(p.playerColor),
    num(p.rank),
    num(p.points),
    p.quitWithPenalty ? 1 : 0,
    p.isHuman ? 1 : 0,
  ]);
  if (!players.some((p) => p[2] === 1)) return null; // need a winner
  return [
    str(String(g.id), 20),
    Math.round(num(g.startTime) / 1000),
    Math.round(num(g.duration) / 1000),
    num(g.turnCount),
    num(s.gameType),
    num(s.eloType),
    num(s.modeSetting),
    num(s.mapSetting),
    num(s.diceSetting),
    num(s.victoryPointsToWin, 10),
    s.privateGame ? 1 : 0,
    players,
  ];
}

// Per-player summary for players we crawled (all of them are on a public
// leaderboard). Only aggregates are stored, not the full game list.
function summarisePlayer(username, userId, games) {
  const seat = [0, 1, 2, 3].map(() => [0, 0]);
  let n = 0, w = 0, vp = 0, quits = 0;
  const recent = [];
  for (const g of games) {
    const me = g.players?.find((p) => String(p.userId) === String(userId));
    if (!g.finished || !me) continue;
    n++;
    const won = me.rank === 1;
    if (won) w++;
    vp += num(me.points);
    if (me.quitWithPenalty) quits++;
    const o = num(me.playOrder);
    if (o >= 1 && o <= 4 && g.players.length === 4) {
      seat[o - 1][0]++;
      if (won) seat[o - 1][1]++;
    }
    recent.push([
      Math.round(num(g.startTime) / 1000),
      num(g.setting?.eloType),
      num(me.rank),
      num(me.points),
      g.players.length,
      o,
      num(g.turnCount),
    ]);
  }
  recent.sort((a, b) => b[0] - a[0]);
  return { u: username, n, w, vp, quits, seat, recent: recent.slice(0, 20) };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const t0 = Date.now();
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Crawl: top ${TOP_N} per mode, ${CONCURRENCY}x concurrency, ${DELAY_MS}ms delay`);

  const tabs = await getJson("/leaderboards-tabs/0").catch(() => null);
  const leaderboards = {};
  const queue = new Map(); // lowercased username -> { username, modes }
  for (const mode of MODES) {
    try {
      leaderboards[mode] = await fetchLeaderboard(mode);
    } catch (err) {
      console.warn(`Leaderboard ${mode} failed: ${err.message}`);
      leaderboards[mode] = [];
    }
    console.log(`  ${mode}: ${leaderboards[mode].length} players`);
    for (const r of leaderboards[mode]) {
      const key = r.username.toLowerCase();
      const entry = queue.get(key) ?? { username: r.username, modes: {} };
      entry.modes[mode] = { rank: r.rank, rating: r.rating };
      queue.set(key, entry);
    }
  }

  const prev = await readJson(join(OUT_DIR, "games.json"), { v: DATA_VERSION, games: [] });
  const byId = new Map((prev.v === DATA_VERSION ? prev.games : []).map((g) => [g[0], g]));
  const prevIds = new Set(byId.keys());

  const players = {};
  const todo = [...queue.values()];
  let done = 0, failed = 0;
  const worker = async () => {
    while (todo.length) {
      const entry = todo.shift();
      try {
        const hist = await getJson(`/profile/${encodeURIComponent(entry.username)}/history`);
        const games = Array.isArray(hist?.gameDatas) ? hist.gameDatas : [];
        for (const g of games) {
          const enc = encodeGame(g);
          if (enc) byId.set(enc[0], enc);
        }
        players[entry.username.toLowerCase()] = {
          ...summarisePlayer(entry.username, hist?.profileUserId, games),
          modes: entry.modes,
        };
      } catch (err) {
        failed++;
        console.warn(`  history ${entry.username}: ${err.message}`);
      }
      done++;
      if (done % 50 === 0) console.log(`  histories ${done}/${queue.size}`);
      await sleep(DELAY_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const cutoff = Date.now() / 1000 - RETENTION_DAYS * 86400;
  const games = [...byId.values()]
    .filter((g) => g[1] >= cutoff)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_GAMES);

  const meta = {
    generatedAt: new Date().toISOString(),
    topN: TOP_N,
    modes: MODES,
    playersCrawled: Object.keys(players).length,
    historyFailures: failed,
    gamesTotal: games.length,
    gamesAdded: games.filter((g) => !prevIds.has(g[0])).length,
    retentionDays: RETENTION_DAYS,
    season: tabs?.activeSeasonData
      ? {
          number: num(tabs.activeSeasonData.name?.options?.seasonNumber),
          start: str(tabs.activeSeasonData.startDate, 40),
          end: str(tabs.activeSeasonData.endDate, 40),
        }
      : null,
  };

  await writeFile(join(OUT_DIR, "games.json"), JSON.stringify({ v: DATA_VERSION, games }));
  await writeFile(join(OUT_DIR, "leaderboards.json"), JSON.stringify(leaderboards));
  await writeFile(join(OUT_DIR, "players.json"), JSON.stringify(players));
  await writeFile(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(
    `Done in ${Math.round((Date.now() - t0) / 1000)}s: ${meta.playersCrawled} players, ` +
      `${games.length} games (${meta.gamesAdded} new), ${failed} failures`,
  );
  if (meta.playersCrawled === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
