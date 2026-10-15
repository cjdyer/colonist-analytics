import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadGames, loadLeaderboards, loadMeta, loadPlayers, type Game, type LeaderboardRow, type Meta, type PlayerSummary } from "../data";
import { QUEUES, QUEUE_ORDER, label, mapName } from "../enums";
import {
  bucketSeats, ci95, delta, expectedRate, filterGames, histogram, margins, mean, median, tier, vpByPlace, wilsonLow, winRate,
  type Bucket, type Filters,
} from "../stats";
import { weekGrid } from "../insights";
import { BarChart, Card, DeltaBar, Empty, Insight, Loaded, SeatBadge, TierBadge, Tile, WeekHeatmap, ordinal } from "../components";
import { duration, fixed, flag, int, pct, playerPath, signedPp } from "../format";
import { useAsync, useTitle } from "../hooks";

const DAY_OPTIONS = [7, 14, 30, 0];
/** Queues with their own leaderboard, for the in-form list. */
const QUEUE_LADDER: Record<number, string> = { 4: "Classic4P", 3: "Classic1v1", 5: "CitiesAndKnights4P", 7: "Rush4P" };

function readFilters(q: URLSearchParams): Filters {
  const queue = q.get("q");
  const days = Number(q.get("d"));
  return {
    queue: queue === "all" ? "all" : queue != null && QUEUES[Number(queue)] ? Number(queue) : 4,
    days: q.has("d") && DAY_OPTIONS.includes(days) ? days : 30,
    noQuitters: q.get("nq") === "1",
  };
}

function hrefWith(f: Filters, patch: Partial<Filters>): string {
  const n = { ...f, ...patch };
  return `/?q=${n.queue}&d=${n.days}&nq=${n.noQuitters ? 1 : 0}`;
}

function Chip({ on, to, children }: { on: boolean; to: string; children: ReactNode }) {
  return <Link className={`chip ${on ? "on" : ""}`} to={to}>{children}</Link>;
}

function FilterBar({ f, counts }: { f: Filters; counts: Map<number, number> }) {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return (
    <div className="filters">
      <div className="filter-group">
        <span className="filter-label">Queue</span>
        <div className="chip-row" aria-label="Queue">
          {QUEUE_ORDER.filter((q) => counts.get(q)).map((q) => (
            <Chip key={q} on={f.queue === q} to={hrefWith(f, { queue: q })}>
              {QUEUES[q]} <small>{int(counts.get(q) ?? 0)}</small>
            </Chip>
          ))}
          <Chip on={f.queue === "all"} to={hrefWith(f, { queue: "all" })}>All <small>{int(total)}</small></Chip>
        </div>
      </div>
      <div className="filter-group">
        <span className="filter-label">Period</span>
        <div className="chip-row" aria-label="Time window">
          {DAY_OPTIONS.map((d) => (
            <Chip key={d} on={f.days === d} to={hrefWith(f, { days: d })}>{d ? `Last ${d} days` : "All time"}</Chip>
          ))}
          <Chip on={f.noQuitters} to={hrefWith(f, { noQuitters: !f.noQuitters })}>{f.noQuitters ? "✓ " : ""}Exclude games with quitters</Chip>
        </div>
      </div>
    </div>
  );
}

function TurnOrder({ rows, minGames, seatCount }: { rows: Bucket[]; minGames: number; seatCount: number }) {
  if (!rows.length) return null;
  return (
    <Card
      title="Turn order"
      sub={<>Win rate by seat{seatCount ? `, against a fair share of ${pct(1 / seatCount, 0)}` : ""}. ± is the 95% interval: a gap smaller than that could be luck. Tiers need ≥{int(minGames)} games.</>}
    >
      <div className="table-wrap">
        <table className="tier-table">
          <thead>
            <tr>
              <th>Seat</th><th>Tier</th><th className="num">Win rate</th><th className="num">vs fair</th>
              <th className="bar-cell"><span className="sr">Bar</span></th><th className="num">Avg VP</th>
              {seatCount > 2 && <th className="num">Avg finish</th>}<th className="num">Games</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const ci = ci95(b.wins, b.games), d = delta(b), wr = winRate(b);
              return (
                <tr key={b.key}>
                  <td className="name"><SeatBadge n={b.key} />{seatCount === 2 ? (b.key === 1 ? "Going first" : "Going second") : b.key === 1 ? "First" : `Seat ${b.key}`}</td>
                  <td><TierBadge tier={tier(b, minGames)} /></td>
                  <td className="num" data-tip={`95% interval ${pct(Math.max(0, wr - ci))} – ${pct(wr + ci)}`}>
                    <strong>{pct(wr, 1)}</strong> <small>±{(ci * 100).toFixed(1)}</small>
                  </td>
                  <td className={`num delta ${d >= 0 ? "pos" : "neg"}`}>{signedPp(d)}</td>
                  <td className="bar-cell"><DeltaBar delta={d} /></td>
                  <td className="num">{fixed(b.vp / b.games, 2)}</td>
                  {seatCount > 2 && <td className="num">{fixed(b.finish / b.games, 2)}</td>}
                  <td className="num">{int(b.games)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const LENGTH_EDGES = [0, 50, 60, 70, 80, 90, Infinity];
const LENGTH_NAMES = ["<50", "50–59", "60–69", "70–79", "80–89", "90+"];

function LengthHeat({ games, seats }: { games: Game[]; seats: number }) {
  if (seats < 2 || seats > 4) return null;
  const cols = LENGTH_NAMES.map((_, i) => games.filter((g) => g.turns >= LENGTH_EDGES[i] && g.turns < LENGTH_EDGES[i + 1]));
  return (
    <Card
      title="Turn order by game length"
      sub="Which seat wins short games and which wins long ones. Blue = above the fair share, red = below. Cells under 20 games are hidden."
    >
      <div className="table-wrap">
        <table className="heat-table">
          <thead>
            <tr>
              <th>Turns</th>
              {LENGTH_NAMES.map((n, i) => (
                <th key={n} className="num">{n}<br /><small>{int(cols[i].length)} games</small></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: seats }, (_, s) => (
              <tr key={s}>
                <td className="name"><SeatBadge n={s + 1} />{seats === 2 ? (s === 0 ? "Going first" : "Going second") : `Seat ${s + 1}`}</td>
                {cols.map((cg, i) => {
                  const b = bucketSeats(cg, (seat) => (seat.order === s + 1 ? 1 : null))[0];
                  if (!b || b.games < 20) return <td key={i} className="num heat na">–</td>;
                  const d = delta(b);
                  return (
                    <td
                      key={i}
                      className={`num heat ${d >= 0 ? "pos" : "neg"}`}
                      style={{ "--a": Math.min(1, Math.abs(d) / 0.08).toFixed(2) } as CSSProperties}
                      data-tip={`Seat ${s + 1}, ${LENGTH_NAMES[i]} turns: ${pct(winRate(b))} over ${b.games} games (fair ${pct(expectedRate(b))})`}
                    >
                      {pct(winRate(b), 0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CloseFinishes({ games, seats }: { games: Game[]; seats: number }) {
  const m = margins(games);
  if (m.length < 50) return null;
  const counts = new Map<number, number>();
  const cap = seats === 2 ? 10 : 6;
  for (const x of m) counts.set(Math.min(x, cap), (counts.get(Math.min(x, cap)) ?? 0) + 1);
  const places = seats >= 2 && seats <= 4 ? vpByPlace(games, seats) : [];
  return (
    <Card title="How close games are" sub={`Winning margin: the winner's VP minus ${seats === 2 ? "the loser's" : "the runner-up's"}.`}>
      <BarChart
        label="Games by winning margin"
        height={150}
        bins={Array.from({ length: cap + 1 }, (_, k) => k).filter((k) => k > 0 || counts.get(0)).map((k) => {
          const c = counts.get(k) ?? 0;
          const name = k === cap ? `${cap}+ VP` : `${k} VP`;
          return { label: name, value: c, tip: `Won by ${name}: ${int(c)} games (${pct(c / m.length)})` };
        })}
      />
      {places.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Finish</th><th className="num">Avg VP</th><th className="num">Within 1 VP of winning</th></tr></thead>
            <tbody>
              {places.filter((r) => r.n).map((r) => (
                <tr key={r.place}>
                  <td className="name">{r.place === 1 ? "Winner" : seats === 2 ? "Loser" : ordinal(r.place)}</td>
                  <td className="num">{fixed(r.vp / r.n, 1)}</td>
                  <td className="num">{r.place === 1 ? "–" : pct(r.close / r.n, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

interface FormRow { name: string; n: number; w: number; place: number; rank?: number; country?: string }

function inForm(players: Record<string, PlayerSummary>, board: LeaderboardRow[], queue: number): { rows: FormRow[]; full: boolean } {
  const ladder = new Map(board.map((r) => [r.username.toLowerCase(), r]));
  const full = Object.values(players).some((p) => p.q);
  const minGames = full ? 15 : 8;
  const rows: FormRow[] = [];
  for (const [key, p] of Object.entries(players)) {
    let n = 0, w = 0, place = 0;
    const t = p.q?.[queue];
    if (t) [n, w, place] = t;
    else if (!full) for (const r of p.recent) if (r[1] === queue) { n++; w += r[2] === 1 ? 1 : 0; place += r[2]; }
    if (n < minGames) continue;
    const l = ladder.get(key);
    rows.push({ name: p.u, n, w, place, rank: l?.rank, country: l?.country });
  }
  rows.sort((a, b) => wilsonLow(b.w, b.n) - wilsonLow(a.w, a.n));
  return { rows: rows.slice(0, 10), full };
}

function InForm({ queue, players, boards }: { queue: number; players: Record<string, PlayerSummary>; boards: Record<string, LeaderboardRow[]> }) {
  const ladder = QUEUE_LADDER[queue];
  const duel = ladder === "Classic1v1";
  const { rows, full } = useMemo(() => inForm(players, boards[ladder] ?? [], queue), [players, boards, ladder, queue]);
  if (!rows.length) return null;
  return (
    <Card
      title="Top players in form"
      sub={`Crawled ladder players with the best recent results in this queue (their last ${full ? "100" : "20"} games). Ranked by the low end of the 95% interval, so a short lucky run doesn't top the list.`}
    >
      <div className="table-wrap">
        <table>
          <thead><tr><th>Player</th><th className="num">Ladder</th><th className="num">Games</th><th className="num">Win rate</th>{duel ? null : <th className="num">Avg finish</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="name">{r.country && <span className="flag">{flag(r.country)}</span>}<Link to={playerPath(r.name)}>{r.name}</Link></td>
                <td className="num muted">{r.rank ? `#${int(r.rank)}` : "–"}</td>
                <td className="num">{r.n}</td>
                <td className="num"><strong>{pct(r.w / r.n, 0)}</strong></td>
                {duel ? null : <td className="num">{fixed(r.place / r.n, 2)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MetaView({ all, meta, players, boards }: { all: Game[]; meta: Meta; players: Record<string, PlayerSummary>; boards: Record<string, LeaderboardRow[]> }) {
  const [params] = useSearchParams();
  const f = readFilters(params);
  const queueName = f.queue === "all" ? "All queues" : label(QUEUES, f.queue);
  useTitle(`${queueName} meta`);

  const s = useMemo(() => {
    const timeOnly = filterGames(all, { ...f, queue: "all" });
    const counts = new Map<number, number>();
    for (const g of timeOnly) counts.set(g.queue, (counts.get(g.queue) ?? 0) + 1);

    const games = filterGames(all, f);
    const ordered = games.filter((g) => g.seats.every((x) => x.order > 0));
    const turns = games.map((g) => g.turns);
    const maps = new Map<number, number>();
    for (const g of games) maps.set(g.map, (maps.get(g.map) ?? 0) + 1);
    const maxTurns = Math.min(200, Math.ceil(Math.max(60, ...turns) / 5) * 5);
    const seatCount = Math.max(0, ...games.map((g) => g.seats.length));
    const seats = bucketSeats(ordered.filter((g) => g.seats.length === seatCount), (x) => x.order || null);
    const m = margins(games);
    const grid = weekGrid(games.map((g) => g.t));
    let peak = { d: 0, h: 0, v: -1 };
    grid.forEach((row, d) => row.forEach((v, h) => v > peak.v && (peak = { d, h, v })));

    return {
      counts,
      games,
      ordered,
      turns,
      minGames: Math.max(30, Math.round(games.length * 0.01)),
      seatCount,
      seats,
      best: [...seats].sort((a, b) => delta(b) - delta(a))[0],
      oneVp: m.length ? m.filter((x) => x <= 1).length / m.length : 0,
      grid,
      peak,
      quitRate: games.length ? games.filter((g) => g.seats.some((x) => x.quit)).length / games.length : 0,
      maps: [...maps.entries()].sort((a, b) => b[1] - a[1]),
      hist: histogram(turns.filter((t) => t > 0), 5, 0, maxTurns).filter((b) => b.from >= 20 || b.count > 0),
    };
    // f is derived from params; recompute only when the query string changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, params.toString()]);

  const DAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

  return (
    <>
      <header className="page-head">
        <h1>{queueName} <span className="muted">meta</span></h1>
        <p className="muted">
          Updated {new Date(meta.generatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          {meta.season && ` · Season ${int(meta.season.number)}`} · recent games of the top {int(meta.topN)} players on each ladder, so these are high-rated games.
        </p>
      </header>
      <FilterBar f={f} counts={s.counts} />
      {s.games.length === 0 ? (
        <Empty>No games match these filters yet.</Empty>
      ) : (
        <>
          <div className="insights lead">
            {s.best && s.best.games >= s.minGames && (
              delta(s.best) > ci95(s.best.wins, s.best.games) ? (
                <Insight value={pct(winRate(s.best), 1)} tone="pos">
                  win rate for <strong>{s.best.key === 1 ? "the first player" : `seat ${s.best.key}`}</strong>, the best seat ({signedPp(delta(s.best))} pp vs fair).
                </Insight>
              ) : (
                <Insight value="No edge">
                  from turn order: every seat wins within <strong>±{fixed(Math.max(...s.seats.map((b) => Math.abs(delta(b)))) * 100, 1)} pp</strong> of a fair share, which is inside the margin of error.
                </Insight>
              )
            )}
            {s.oneVp > 0 && <Insight value={pct(s.oneVp, 0)}>of games are won by <strong>a single VP</strong>.</Insight>}
            <Insight value={`${fixed(median(s.turns), 0)} turns`}>
              in a typical game, about <strong>{duration(median(s.games.map((g) => g.dur)))}</strong>.
            </Insight>
            {s.peak.v > 0 && (
              <Insight value={`${String(s.peak.h).padStart(2, "0")}:00`}>
                on <strong>{DAYS[s.peak.d]}</strong> is the busiest hour in this sample (your local time).
              </Insight>
            )}
          </div>

          <TurnOrder rows={s.seats} minGames={s.minGames} seatCount={s.seatCount} />
          <LengthHeat games={s.ordered} seats={s.seatCount} />
          <div className="split even">
            <CloseFinishes games={s.games} seats={s.seatCount} />
            {f.queue !== "all" && QUEUE_LADDER[f.queue] && <InForm queue={f.queue} players={players} boards={boards} />}
          </div>
          <div className="split even">
            <Card title="When games are played" sub={`Games started per hour, in your local time. Busy hours mean shorter queues.`}>
              <WeekHeatmap grid={s.grid} />
            </Card>
            <Card title="Game length" sub={`Games per 5-turn bucket. Mean ${fixed(mean(s.turns), 1)} turns.`}>
              <BarChart
                label="Games by turn count"
                bins={s.hist.map((b) => ({ label: String(b.from), value: b.count, tip: `${b.from}–${b.to - 1} turns: ${int(b.count)} games` }))}
              />
            </Card>
          </div>
          <div className="tiles">
            <Tile label="Games in sample" value={int(s.games.length)} />
            <Tile label="Median length" value={duration(median(s.games.map((g) => g.dur)))} />
            <Tile label="Games with a quitter" value={pct(s.quitRate)} />
            <Tile label="Players crawled" value={int(meta.playersCrawled)} />
          </div>
          {s.maps.length > 1 && (
            <Card title="Maps">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Map</th><th className="num">Games</th><th className="num">Share</th></tr></thead>
                  <tbody>
                    {s.maps.slice(0, 8).map(([m, n]) => (
                      <tr key={m}><td>{mapName(m)}</td><td className="num">{int(n)}</td><td className="num">{pct(n / s.games.length)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}

export function MetaPage() {
  const state = useAsync(() =>
    Promise.all([
      loadGames(),
      loadMeta(),
      loadPlayers().catch(() => ({}) as Record<string, PlayerSummary>),
      loadLeaderboards().catch(() => ({}) as Record<string, LeaderboardRow[]>),
    ]),
  );
  return <Loaded state={state}>{([all, meta, players, boards]) => <MetaView all={all} meta={meta} players={players} boards={boards} />}</Loaded>;
}
