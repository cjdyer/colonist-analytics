import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { loadLeaderboards, type LeaderboardRow } from "../data";
import { api, apiEnabled, CONTINENT_CODES, continentName, divisionName, type LeaderboardScope, type LiveLeaderboardRow } from "../api";
import { LEADERBOARD_MODES } from "../enums";
import { Empty, Loaded } from "../components";
import { fixed, flag, int, playerPath } from "../format";
import { useAsync } from "../hooks";

const MODES = Object.keys(LEADERBOARD_MODES);
const PAGE = 100;

function ModeChips({ mode, keep = "" }: { mode: string; keep?: string }) {
  return (
    <div className="filters">
      <div className="chip-row">
        {MODES.map((m) => (
          <Link key={m} className={`chip ${m === mode ? "on" : ""}`} to={`/leaderboard/${m}${keep}`}>{LEADERBOARD_MODES[m]}</Link>
        ))}
      </div>
    </div>
  );
}

interface Row {
  rank: number;
  username: string;
  country: string;
  rating: number;
  winRate: number;
  games: number;
  division?: number;
  subdivision?: number;
}

function RankTable({ rows, showDivision }: { rows: Row[]; showDivision?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="num">#</th><th>Player</th>{showDivision && <th>Division</th>}
            <th className="num">Rating</th><th className="num">Win rate</th><th className="num">Games</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.rank}-${r.username}`}>
              <td className="num">{int(r.rank)}</td>
              <td className="name">
                <span className="flag" title={r.country}>{flag(r.country)}</span>
                <Link to={playerPath(r.username)}>{r.username}</Link>
              </td>
              {showDivision && <td>{divisionName(r.division ?? 7, r.subdivision)}</td>}
              <td className="num"><strong>{int(r.rating)}</strong></td>
              <td className="num">{fixed(r.winRate, 1)}%</td>
              <td className="num">{int(r.games)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const fromLive = (r: LiveLeaderboardRow): Row => ({
  rank: r.rank,
  username: r.username,
  country: r.countryCode,
  rating: r.skillRating,
  winRate: r.winRate,
  games: r.totalGamesPlayed,
  division: r.division,
  subdivision: r.subdivision,
});

// --- Live -----------------------------------------------------------------

function LiveLeaderboard({ mode }: { mode: string }) {
  const [query] = useSearchParams();
  const navigate = useNavigate();
  const country = /^[A-Z]{2}$/.test(query.get("country") ?? "") ? query.get("country")! : "";
  const continent = CONTINENT_CODES.includes(query.get("continent") ?? "") ? query.get("continent")! : "";
  const start = Math.max(1, Number.parseInt(query.get("start") ?? "1", 10) || 1);
  const q = (query.get("q") ?? "").slice(0, 40);
  const scope: LeaderboardScope = country ? { country } : continent ? { continent } : {};

  const state = useAsync(
    () => (q.length >= 2 ? api.leaderboardSearch(mode, q, scope) : api.leaderboard(mode, start, scope)),
    [mode, country, continent, start, q],
  );
  const [draftQ, setDraftQ] = useState(q);
  const [draftCountry, setDraftCountry] = useState(country);

  const go = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    const merged = { country, continent, start: String(start), q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "start" && String(v) === "1")) next.set(k, String(v));
    const qs = next.toString();
    navigate(`/leaderboard/${mode}${qs ? `?${qs}` : ""}`);
  };
  const keep = (() => {
    const p = new URLSearchParams();
    if (country) p.set("country", country);
    if (continent) p.set("continent", continent);
    return p.toString() ? `?${p}` : "";
  })();

  const scopeLabel = country ? `${flag(country)} ${country}` : continent ? continentName(continent) : "Global";

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Leaderboard <span className="muted">{LEADERBOARD_MODES[mode]}</span></h1>
          <p className="muted">Live from colonist.io · current ranked season</p>
        </div>
      </header>
      <ModeChips mode={mode} keep={keep} />
      <div className="filters">
        <div className="chip-row" aria-label="Region">
          <button className={`chip ${!country && !continent ? "on" : ""}`} onClick={() => go({ country: "", continent: "", start: 1 })}>Global</button>
          {CONTINENT_CODES.filter((c) => c !== "AN").map((c) => (
            <button key={c} className={`chip ${continent === c ? "on" : ""}`} onClick={() => go({ continent: c, country: "", start: 1 })}>{continentName(c)}</button>
          ))}
          <form
            className="inline-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const c = draftCountry.trim().toUpperCase();
              if (/^[A-Z]{2}$/.test(c)) go({ country: c, continent: "", start: 1 });
            }}
          >
            <input type="search" placeholder="Country (e.g. AU)" aria-label="Country code" maxLength={2} value={draftCountry} onChange={(e) => setDraftCountry(e.target.value)} />
          </form>
        </div>
      </div>
      <section className="card">
        <div className="card-head">
          <h2>{q.length >= 2 ? `“${q}” in ${scopeLabel}` : scopeLabel}</h2>
          <form
            className="inline-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              go({ q: draftQ.trim(), start: 1 });
            }}
          >
            <input type="search" placeholder="Search name (Enter)" aria-label="Search leaderboard" maxLength={40} value={draftQ} onChange={(e) => setDraftQ(e.target.value)} />
          </form>
        </div>
        <Loaded state={state}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted">No players found.</p>
            ) : (
              <>
                <RankTable rows={rows.map(fromLive)} showDivision />
                {q.length < 2 && (
                  <div className="pager">
                    <button className="btn ghost" disabled={start <= 1} onClick={() => go({ start: Math.max(1, start - PAGE) })}>← Prev</button>
                    <span className="muted">Ranks {int(start)}–{int(start + rows.length - 1)}</span>
                    <button className="btn ghost" disabled={rows.length < PAGE} onClick={() => go({ start: start + PAGE })}>Next →</button>
                  </div>
                )}
              </>
            )
          }
        </Loaded>
      </section>
    </>
  );
}

// --- Snapshot -------------------------------------------------------------

function SnapshotLeaderboard({ mode, boards }: { mode: string; boards: Record<string, LeaderboardRow[]> }) {
  const [query] = useSearchParams();
  const [needle, setNeedle] = useState("");
  const rows = boards[mode] ?? [];
  const raw = (query.get("country") ?? "").toUpperCase();
  const country = /^[A-Z]{2}$/.test(raw) ? raw : "";

  const countries = useMemo(() => {
    const by = new Map<string, LeaderboardRow[]>();
    for (const r of rows) if (r.country) by.set(r.country, [...(by.get(r.country) ?? []), r]);
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [rows]);

  const n = needle.trim().toLowerCase();
  const shown = rows.filter((r) => (!country || r.country === country) && (!n || r.username.toLowerCase().includes(n)));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Leaderboard <span className="muted">{LEADERBOARD_MODES[mode]}</span></h1>
          <p className="muted">Top {int(rows.length)} from the snapshot. Configure the live API for full, up-to-date ladders.</p>
        </div>
      </header>
      <ModeChips mode={mode} />
      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>{country ? `${flag(country)} ${country}` : "Global"}</h2>
            <input type="search" placeholder="Filter by name" aria-label="Filter by name" maxLength={40} value={needle} onChange={(e) => setNeedle(e.target.value)} />
          </div>
          <RankTable rows={shown} />
        </section>
        <section className="card">
          <h2>Countries</h2>
          <p className="muted">Players in this top {int(rows.length)}. Click to filter.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Country</th><th className="num">Players</th><th className="num">Avg rating</th></tr></thead>
              <tbody>
                {country && <tr><td colSpan={3}><Link to={`/leaderboard/${mode}`}>← All countries</Link></td></tr>}
                {countries.map(([c, rs]) => (
                  <tr key={c} className={c === country ? "on" : ""}>
                    <td><Link to={`/leaderboard/${mode}?country=${c}`}>{flag(c)} {c}</Link></td>
                    <td className="num">{rs.length}</td>
                    <td className="num">{int(rs.reduce((a, r) => a + r.rating, 0) / rs.length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function SnapshotLoader({ mode }: { mode: string }) {
  const state = useAsync(loadLeaderboards);
  return <Loaded state={state}>{(boards) => <SnapshotLeaderboard mode={mode} boards={boards} />}</Loaded>;
}

export function LeaderboardPage() {
  const params = useParams();
  const mode = params.mode && MODES.includes(params.mode) ? params.mode : "Classic4P";
  if (params.mode && !MODES.includes(params.mode)) return <Empty>Unknown leaderboard. <Link to="/leaderboard/Classic4P">Classic 4P</Link></Empty>;
  return apiEnabled ? <LiveLeaderboard key={mode} mode={mode} /> : <SnapshotLoader mode={mode} />;
}
