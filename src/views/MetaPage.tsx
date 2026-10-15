import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadGames, loadMeta, type Game, type Meta } from "../data";
import { PLAYER_COLORS, QUEUES, QUEUE_ORDER, label, mapName } from "../enums";
import {
  bucketSeats, ci95, delta, expectedRate, filterGames, histogram, mean, median, tier, winRate,
  type Bucket, type Filters,
} from "../stats";
import { BarChart, Card, DeltaBar, Empty, Loaded, SeatBadge, Swatch, TierBadge, Tile } from "../components";
import { duration, fixed, int, pct, signedPp } from "../format";
import { useAsync } from "../hooks";

const DAY_OPTIONS = [7, 14, 30, 0];

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
      <div className="chip-row" aria-label="Queue">
        {QUEUE_ORDER.filter((q) => counts.get(q)).map((q) => (
          <Chip key={q} on={f.queue === q} to={hrefWith(f, { queue: q })}>
            {QUEUES[q]} <small>{int(counts.get(q) ?? 0)}</small>
          </Chip>
        ))}
        <Chip on={f.queue === "all"} to={hrefWith(f, { queue: "all" })}>
          All queues <small>{int(total)}</small>
        </Chip>
      </div>
      <div className="chip-row" aria-label="Time window">
        {DAY_OPTIONS.map((d) => (
          <Chip key={d} on={f.days === d} to={hrefWith(f, { days: d })}>{d ? `${d}d` : "All"}</Chip>
        ))}
        <Chip on={f.noQuitters} to={hrefWith(f, { noQuitters: !f.noQuitters })}>Exclude games with quitters</Chip>
      </div>
    </div>
  );
}

function TierTable({ title, sub, rows, name, minGames }: {
  title: string; sub: ReactNode; rows: Bucket[]; name: (b: Bucket) => ReactNode; minGames: number;
}) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => delta(b) - delta(a));
  return (
    <Card title={title} sub={sub}>
      <div className="table-wrap">
        <table className="tier-table">
          <thead>
            <tr>
              <th>Name</th><th>Tier</th><th className="num">Win rate</th><th className="num">Δ pp</th>
              <th><span className="sr">Delta bar</span></th><th className="num">Avg VP</th>
              <th className="num">Avg finish</th><th className="num">Games</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => {
              const ci = ci95(b.wins, b.games), d = delta(b), wr = winRate(b);
              return (
                <tr key={b.key}>
                  <td className="name">{name(b)}</td>
                  <td><TierBadge tier={tier(b, minGames)} /></td>
                  <td className="num" data-tip={`95% CI ${pct(Math.max(0, wr - ci))} – ${pct(wr + ci)}`}>
                    <strong>{pct(wr, 2)}</strong> <small>±{(ci * 100).toFixed(1)}</small>
                  </td>
                  <td className={`num delta ${d >= 0 ? "pos" : "neg"}`}>{signedPp(d)}</td>
                  <td className="bar-cell"><DeltaBar delta={d} /></td>
                  <td className="num">{fixed(b.vp / b.games, 2)}</td>
                  <td className="num">{fixed(b.finish / b.games, 2)}</td>
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
      title="Seat win rate by game length"
      sub="Turn count buckets. Cells with fewer than 20 games are hidden. Blue = above the fair share, red = below."
    >
      <div className="table-wrap">
        <table className="heat-table">
          <thead>
            <tr>
              <th>Seat</th>
              {LENGTH_NAMES.map((n, i) => (
                <th key={n} className="num">{n}<br /><small>{int(cols[i].length)} games</small></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: seats }, (_, s) => (
              <tr key={s}>
                <td className="name">Seat {s + 1}</td>
                {cols.map((cg, i) => {
                  const b = bucketSeats(cg, (seat) => (seat.order === s + 1 ? 1 : null))[0];
                  if (!b || b.games < 20) return <td key={i} className="num heat na">–</td>;
                  const d = delta(b);
                  return (
                    <td
                      key={i}
                      className={`num heat ${d >= 0 ? "pos" : "neg"}`}
                      style={{ "--a": Math.min(1, Math.abs(d) / 0.08).toFixed(2) } as CSSProperties}
                      data-tip={`Seat ${s + 1}: ${pct(winRate(b))} over ${b.games} games (expected ${pct(expectedRate(b))})`}
                    >
                      {pct(winRate(b))}
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

function MetaView({ all, meta }: { all: Game[]; meta: Meta }) {
  const [params] = useSearchParams();
  const f = readFilters(params);

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

    return {
      counts,
      games,
      ordered,
      turns,
      minGames: Math.max(30, Math.round(games.length * 0.01)),
      seatCount: Math.max(0, ...games.map((g) => g.seats.length)),
      seats: bucketSeats(ordered, (x) => x.order || null),
      colors: bucketSeats(games, (x) => x.color || null),
      quitRate: games.length ? games.filter((g) => g.seats.some((x) => x.quit)).length / games.length : 0,
      topMaps: [...maps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      hist: histogram(turns.filter((t) => t > 0), 5, 0, maxTurns).filter((b) => b.from >= 20 || b.count > 0),
    };
    // f is derived from params; recompute only when the query string changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, params.toString()]);

  const queueName = f.queue === "all" ? "All queues" : label(QUEUES, f.queue);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{queueName} <span className="muted">meta</span></h1>
          <p className="muted">
            Snapshot {new Date(meta.generatedAt).toLocaleString()} · sample = recent games of the top {int(meta.topN)} players per ranked ladder
            {meta.season && ` · Season ${int(meta.season.number)}`}
          </p>
        </div>
      </header>
      <FilterBar f={f} counts={s.counts} />
      {s.games.length === 0 ? (
        <Empty>No games match these filters yet.</Empty>
      ) : (
        <>
          <div className="tiles">
            <Tile label="Games" value={int(s.games.length)} />
            <Tile label="Median turns" value={fixed(median(s.turns), 0)} sub={`mean ${fixed(mean(s.turns), 1)}`} />
            <Tile label="Median length" value={duration(median(s.games.map((g) => g.dur)))} />
            <Tile label="Games with a quitter" value={pct(s.quitRate)} />
          </div>
          <TierTable
            title="Turn order tier list"
            sub={`Win rate by play order${s.seatCount ? `, against a fair share of ${pct(1 / s.seatCount, 0)}` : ""}. Tier needs ≥${s.minGames} games; ± is the 95% interval.`}
            rows={s.seats}
            name={(b) => <><SeatBadge n={b.key} /> Seat {b.key}</>}
            minGames={s.minGames}
          />
          <TierTable
            title="Color tier list"
            sub="Colors are mostly cosmetic. Anything far from 0 here is a hint that the sample is too small, or that player skill differs by color."
            rows={s.colors}
            name={(b) => {
              const c = PLAYER_COLORS[b.key];
              return <><Swatch hex={c?.hex ?? "#888"} />{c?.name ?? `#${b.key}`}</>;
            }}
            minGames={s.minGames}
          />
          <LengthHeat games={s.ordered} seats={s.seatCount} />
          <Card title="Game length" sub="Games per 5-turn bucket.">
            <BarChart
              label="Games by turn count"
              bins={s.hist.map((b) => ({ label: String(b.from), value: b.count, tip: `${b.from}–${b.to - 1} turns: ${b.count} games` }))}
            />
          </Card>
          <Card title="Maps">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Map</th><th className="num">Games</th><th className="num">Share</th></tr></thead>
                <tbody>
                  {s.topMaps.map(([m, n]) => (
                    <tr key={m}><td>{mapName(m)}</td><td className="num">{int(n)}</td><td className="num">{pct(n / s.games.length)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

export function MetaPage() {
  const state = useAsync(() => Promise.all([loadGames(), loadMeta()]));
  return <Loaded state={state}>{([all, meta]) => <MetaView all={all} meta={meta} />}</Loaded>;
}
