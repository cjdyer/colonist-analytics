import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { loadPlayers, type PlayerSummary } from "../data";
import { api, apiEnabled, ApiError, divisionName, i18n, type History, type HistoryGame, type RankedMode } from "../api";
import { LEADERBOARD_MODES, PLAYER_COLORS, QUEUES, label, mapName } from "../enums";
import { ci95, summariseHistory } from "../stats";
import { Card, Empty, Loaded, SeatBadge, Swatch, Tile } from "../components";
import { ago, duration, fixed, flag, int, pct, playerPath, signedPp } from "../format";
import { useAsync } from "../hooks";

// --- Shared pieces --------------------------------------------------------

function SeatTable({ seat, players = 4 }: { seat: PlayerSummary["seat"]; players?: number }) {
  const fair = 1 / players;
  return (
    <Card title={<>By seat <small className="muted">{players}-player games</small></>}>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Seat</th><th className="num">Win rate</th><th className="num">Δ vs {pct(fair, 0)}</th><th className="num">Games</th></tr></thead>
          <tbody>
            {seat.map(([n, w], i) =>
              !n ? (
                <tr key={i}><td>Seat {i + 1}</td><td className="num" colSpan={3}>–</td></tr>
              ) : (
                <tr key={i}>
                  <td className="name"><SeatBadge n={i + 1} /> Seat {i + 1}</td>
                  <td className="num"><strong>{pct(w / n)}</strong> <small>±{(ci95(w, n) * 100).toFixed(0)}</small></td>
                  <td className={`num delta ${w / n >= fair ? "pos" : "neg"}`}>{signedPp(w / n - fair)}</td>
                  <td className="num">{n}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// --- Live view (API) ------------------------------------------------------

const DELETED = "Deleted User";

/** Per-seat [games, wins] for the table size this player plays most. */
function seatStats(h: History): { players: number; seat: [number, number][] } {
  const games = h.gameDatas.filter((g) => g.finished);
  const sizes = new Map<number, number>();
  for (const g of games) sizes.set(g.players.length, (sizes.get(g.players.length) ?? 0) + 1);
  const players = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 4;
  const seat = Array.from({ length: players }, () => [0, 0] as [number, number]);
  for (const g of games) {
    const me = g.players.find((p) => p.userId === h.profileUserId);
    if (g.players.length !== players || !me?.playOrder || me.playOrder > players) continue;
    seat[me.playOrder - 1][0]++;
    if (me.rank === 1) seat[me.playOrder - 1][1]++;
  }
  return { players, seat };
}

function RankedCard({ m }: { m: RankedMode }) {
  const state = m.currentRankedState;
  const placement = state?.type === 0 && state.numberOfPlacementGamesRequired;
  const div = state?.currentDivisionState;
  const rating = Number(m.skillRating);
  const lo = div?.demotionDivisionBoundary?.boundary;
  const hi = div?.promotionDivisionBoundary?.boundary;
  const progress = lo != null && hi != null && hi > lo && Number.isFinite(rating) ? Math.min(1, Math.max(0, (rating - lo) / (hi - lo))) : null;

  return (
    <div className="rank-card">
      <div className="rank-head">
        <strong>{m.modeName}</strong>
        <span className="muted">{placement ? `Placement ${state?.numberOfPlacementGamesFinished ?? 0}/${placement}` : divisionName(m.division, m.subdivision)}</span>
      </div>
      <div className="rank-rating">{m.skillRating === "-" ? "–" : int(rating)}</div>
      <div className="muted rank-sub">
        {m.winRate === "-" ? "No games" : `${m.winRate}% win · ${m.gamesPlayed} games`}
      </div>
      {progress != null && (
        <div className="progress" data-tip={`${int(lo!)} demotion · ${int(hi!)} promotion`}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {m.rankedStanding && m.rankedStanding.some((s) => s.rank !== "-") && (
        <ul className="standings">
          {m.rankedStanding.map((s, i) => (
            <li key={i}><span className="muted">{i18n(s.name)}</span> #{s.rank}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RankedSection({ name }: { name: string }) {
  const seasons = useAsync(api.seasons);
  const [season, setSeason] = useState<number | undefined>();
  const ranked = useAsync(() => api.ranked(name, season), [name, season]);
  return (
    <Card>
      <div className="card-head">
        <h2>Ranked</h2>
        {seasons.status === "ready" && (
          <select aria-label="Season" value={season ?? seasons.data[0]?.seasonType} onChange={(e) => setSeason(Number(e.target.value))}>
            {seasons.data.map((s) => (
              <option key={s.seasonType} value={s.seasonType}>{i18n(s.name)}</option>
            ))}
          </select>
        )}
      </div>
      <Loaded state={ranked}>
        {(r) => (
          <div className="rank-grid">
            {r.modes.map((m) => <RankedCard key={m.modeType + m.modeName} m={m} />)}
          </div>
        )}
      </Loaded>
    </Card>
  );
}

function PlayersCell({ g, me }: { g: HistoryGame; me: string }) {
  const sorted = [...g.players].sort((a, b) => a.rank - b.rank);
  return (
    <span className="players">
      {sorted.map((p) => {
        const c = PLAYER_COLORS[p.playerColor];
        const self = p.userId === me;
        return (
          <span key={p.userId} className={`pl ${self ? "self" : ""}`} data-tip={`#${p.rank} · ${p.points} VP${p.quitWithPenalty ? " · quit" : ""}${p.isHuman ? "" : " · bot"}`}>
            <Swatch hex={c?.hex ?? "#888"} />
            {self || !p.isHuman || p.username === DELETED ? p.username : <Link to={playerPath(p.username)}>{p.username}</Link>}
          </span>
        );
      })}
    </span>
  );
}

function MatchHistory({ h }: { h: History }) {
  const [shown, setShown] = useState(20);
  const games = h.gameDatas.filter((g) => g.finished);
  return (
    <Card title={<>Match history <small className="muted">last {games.length}</small></>}>
      <div className="table-wrap">
        <table className="history">
          <thead>
            <tr><th>When</th><th>Queue</th><th>Map</th><th className="num">Place</th><th className="num">VP</th><th className="num">Seat</th><th className="num">Turns</th><th className="num">Length</th><th>Players</th></tr>
          </thead>
          <tbody>
            {games.slice(0, shown).map((g) => {
              const me = g.players.find((p) => p.userId === h.profileUserId);
              if (!me) return null;
              return (
                <tr key={g.id}>
                  <td>{ago(Number(g.startTime) / 1000)}</td>
                  <td>{label(QUEUES, g.setting.eloType)}</td>
                  <td>{mapName(g.setting.mapSetting)}</td>
                  <td className="num"><span className={`place place-${me.rank === 1 ? "win" : "loss"}`}>{me.rank}/{g.players.length}</span></td>
                  <td className="num">{me.points}</td>
                  <td className="num">{me.playOrder || "–"}</td>
                  <td className="num">{g.turnCount}</td>
                  <td className="num">{duration(Number(g.duration) / 1000)}</td>
                  <td><PlayersCell g={g} me={h.profileUserId} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown < games.length && (
        <p><button className="btn ghost" onClick={() => setShown((n) => n + 40)}>Show more</button></p>
      )}
    </Card>
  );
}

function Opponents({ h }: { h: History }) {
  const rows = useMemo(() => {
    const by = new Map<string, { name: string; games: number; myWins: number; theirWins: number }>();
    for (const g of h.gameDatas) {
      const me = g.players.find((p) => p.userId === h.profileUserId);
      if (!g.finished || !me) continue;
      for (const p of g.players) {
        if (p.userId === h.profileUserId || !p.isHuman || p.username === DELETED) continue;
        const r = by.get(p.userId) ?? { name: p.username, games: 0, myWins: 0, theirWins: 0 };
        r.games++;
        if (me.rank === 1) r.myWins++;
        if (p.rank === 1) r.theirWins++;
        by.set(p.userId, r);
      }
    }
    return [...by.values()].filter((r) => r.games >= 2).sort((a, b) => b.games - a.games).slice(0, 10);
  }, [h]);
  if (!rows.length) return null;
  return (
    <Card title="Frequent opponents" sub="Humans met in 2+ of the last 100 games.">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Player</th><th className="num">Games</th><th className="num">Your wins</th><th className="num">Their wins</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="name"><Link to={playerPath(r.name)}>{r.name}</Link></td>
                <td className="num">{r.games}</td>
                <td className="num">{r.myWins}</td>
                <td className="num">{r.theirWins}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Items({ name }: { name: string }) {
  const items = useAsync(() => api.items(name), [name]);
  if (items.status !== "ready" || !items.data.length) return null;
  return (
    <Card title={<>Items <small className="muted">{items.data.length} owned</small></>}>
      <div className="chip-row">
        {items.data.map((it, i) => <span key={i} className="chip static">{i18n(it.name)}</span>)}
      </div>
    </Card>
  );
}

function LivePlayer({ name, snapshot }: { name: string; snapshot?: PlayerSummary }) {
  const state = useAsync(() => Promise.all([api.player(name), api.history(name)]), [name]);

  if (state.status === "error") {
    const e = state.error;
    if (e instanceof ApiError && e.status === 404) return <Empty>No colonist.io player called “{name}”.</Empty>;
    if (snapshot) return <SnapshotPlayer p={snapshot} note={`Live API unavailable (${e.message}). Showing the snapshot.`} />;
    return <Empty>Couldn't load live data: {e.message}</Empty>;
  }
  if (state.status === "loading") return <p className="muted">Loading live data…</p>;

  const [profile, history] = state.data;
  const summary = summariseHistory(profile.username, history);
  const seats = seatStats(history);
  const modes = Object.entries(snapshot?.modes ?? {});
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{profile.country && <span className="flag">{flag(profile.country)}</span>}{profile.username}</h1>
          <p className="muted">Live from colonist.io{profile.country ? ` · ${profile.country}` : ""} · karma {profile.karma}</p>
          {modes.length > 0 && (
            <div className="chip-row">
              {modes.map(([m, r]) => <span key={m} className="chip static">{LEADERBOARD_MODES[m] ?? m} top #{int(r.rank)}</span>)}
            </div>
          )}
        </div>
      </header>
      <div className="tiles">
        <Tile label="Lifetime games" value={int(profile.gameData.totalGames)} />
        <Tile label="Win rate (last 100)" value={`${profile.gameData.winPercent}%`} sub={summary.n ? `${summary.w} of ${summary.n}` : undefined} />
        <Tile label="VP per game" value={profile.gameData.pointsPerGame} />
        <Tile label="Quit with penalty" value={int(summary.quits)} sub="last 100" />
      </div>
      <RankedSection name={profile.username} />
      <MatchHistory h={history} />
      <div className="split">
        <Opponents h={history} />
        <SeatTable seat={seats.seat} players={seats.players} />
      </div>
      <Items name={profile.username} />
    </>
  );
}

// --- Snapshot view (no API) -----------------------------------------------

function SnapshotPlayer({ p, note }: { p: PlayerSummary; note: string }) {
  const modes = Object.entries(p.modes ?? {});
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{p.u}</h1>
          <p className="muted">{note}</p>
          {modes.length > 0 && (
            <div className="chip-row">
              {modes.map(([m, r]) => (
                <span key={m} className="chip static">{LEADERBOARD_MODES[m] ?? m} · #{int(r.rank)} · {int(r.rating)}</span>
              ))}
            </div>
          )}
        </div>
      </header>
      <div className="tiles">
        <Tile label="Games (last 100)" value={int(p.n)} />
        <Tile label="Win rate" value={p.n ? pct(p.w / p.n) : "–"} sub={p.n ? `${p.w} wins` : undefined} />
        <Tile label="Avg VP" value={p.n ? fixed(p.vp / p.n, 2) : "–"} />
        <Tile label="Quit with penalty" value={int(p.quits)} />
      </div>
      <div className="split">
        <Card title="Recent games">
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Queue</th><th className="num">Place</th><th className="num">VP</th><th className="num">Seat</th><th className="num">Turns</th></tr></thead>
              <tbody>
                {p.recent.map(([t, queue, rank, vp, np, order, turns], i) => (
                  <tr key={i}>
                    <td>{ago(t)}</td>
                    <td>{label(QUEUES, queue)}</td>
                    <td className="num"><span className={`place place-${rank === 1 ? "win" : "loss"}`}>{rank}/{np}</span></td>
                    <td className="num">{vp}</td>
                    <td className="num">{order || "–"}</td>
                    <td className="num">{turns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <SeatTable seat={p.seat} />
      </div>
    </>
  );
}

export function PlayerPage() {
  const name = (useParams().name ?? "").slice(0, 40);
  const players = useAsync(() => loadPlayers().catch(() => ({}) as Record<string, PlayerSummary>));
  return (
    <Loaded state={players}>
      {(all) => {
        const snap = all[name.toLowerCase()];
        if (apiEnabled) return <LivePlayer key={name} name={name} snapshot={snap} />;
        if (snap) return <SnapshotPlayer p={snap} note="From the latest snapshot (leaderboard players only)." />;
        return <Empty>“{name}” isn't in the snapshot, and the live API isn't configured for this site.</Empty>;
      }}
    </Loaded>
  );
}
