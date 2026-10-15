import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { loadPlayers, type PlayerSummary } from "../data";
import { api, apiEnabled, ApiError, divisionName, i18n, type HistoryPlayer, type RankedMode } from "../api";
import { LEADERBOARD_MODES, PLAYER_COLORS, QUEUES, label, mapName } from "../enums";
import {
  byDayPart, byPace, byQueue, bySeat, closeness, edge, fair, fromHistory, fromSnapshot, perDay, placements,
  rate, record, rivals, sessions, significant, streak, weekGrid, type PlayerGame,
} from "../insights";
import { BarChart, Card, Empty, FormStrip, Insight, Loaded, RateRows, SeatBadge, Swatch, Tile, WeekHeatmap, formatName, ordinal, placeLabel } from "../components";
import { ago, duration, fixed, flag, int, pct, playerPath, signedPp } from "../format";
import { useAsync, useTitle } from "../hooks";

// --- Overview ---------------------------------------------------------------

function Summary({ games }: { games: PlayerGame[] }) {
  const rec = record(games);
  const s = streak(games);
  const d = edge(rec);
  const formats = formatCounts(games);
  const mixed = formats.length > 1;
  return (
    <div className="tiles">
      <Tile
        label={`Win rate · last ${rec.n}`}
        value={pct(rate(rec), 0)}
        sub={<><span className={`delta ${d >= 0 ? "pos" : "neg"}`}>{signedPp(d)}</span> vs fair share of {pct(fair(rec), 0)}</>}
      />
      {mixed ? (
        <>
          <Tile label="Record" value={`${rec.w}–${rec.n - rec.w}`} sub="wins – losses" />
          <Tile label="Formats" value={formats.map(([p, n]) => `${n} ${formatName(p)}`).join(" · ")} sub="Pick one format above for averages" />
        </>
      ) : (
        <>
          <Tile label="Avg finish" value={rec.n ? fixed(rec.place / rec.n, 2) : "–"} sub={`${rec.w} wins · ${rec.n - rec.w} losses`} />
          <Tile label="Avg VP" value={rec.n ? fixed(rec.vp / rec.n, 1) : "–"} sub={games[0]?.target ? `${games[0].target} to win` : undefined} />
        </>
      )}
      <Tile
        label="Current streak"
        value={s ? <span className={`delta ${s.won ? "pos" : "neg"}`}>{s.n}{s.won ? "W" : "L"}</span> : "–"}
        sub={s ? (s.won ? `${s.n} win${s.n > 1 ? "s" : ""} in a row` : `${s.n} game${s.n > 1 ? "s" : ""} without a win`) : undefined}
      />
    </div>
  );
}

function QueueTable({ games }: { games: PlayerGame[] }) {
  const rows = byQueue(games);
  return (
    <Card title="By queue" sub="Your recent games split by queue. ‘vs fair’ compares your win rate with 1 ÷ players.">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Queue</th><th className="num">Games</th><th className="num">W–L</th><th className="num">Win rate</th>
              <th className="num">vs fair</th><th className="num">Avg finish</th><th className="num">Avg VP</th><th className="num">Avg turns</th><th className="num">Last</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ queue, rec, turns, last }) => {
              const d = edge(rec);
              return (
                <tr key={queue}>
                  <td className="name">{label(QUEUES, queue)}</td>
                  <td className="num">{rec.n}</td>
                  <td className="num">{rec.w}–{rec.n - rec.w}</td>
                  <td className="num"><strong>{pct(rate(rec), 0)}</strong></td>
                  <td
                    className={`num delta ${significant(rec) ? (d >= 0 ? "pos" : "neg") : "muted"}`}
                    data-tip={significant(rec) ? "Outside the 95% interval: likely a real edge" : "Inside the 95% interval: could still be luck"}
                  >
                    {signedPp(d)}
                  </td>
                  <td className="num">{fixed(rec.place / rec.n, 2)}</td>
                  <td className="num">{fixed(rec.vp / rec.n, 1)}</td>
                  <td className="num">{fixed(turns, 0)}</td>
                  <td className="num muted">{ago(last)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted footnote">Grey gaps are too small, for the number of games, to tell skill from luck.</p>
    </Card>
  );
}

function Placements({ games }: { games: PlayerGame[] }) {
  const p = placements(games);
  if (p.n < 5 || p.players === 2) return null;
  const max = Math.max(...p.counts);
  return (
    <Card title="Finishing places" sub={`${p.players}-player games. The line marks an even ${pct(1 / p.players, 0)} share.`}>
      <div className="hbars">
        {p.counts.map((c, i) => (
          <div key={i} className="hbar-row" data-tip={`${ordinal(i + 1)}: ${c} of ${p.n} games`}>
            <span className="hbar-label">{ordinal(i + 1)}</span>
            <span className="hbar-track">
              <span className={`hbar-fill ${i === 0 ? "win" : ""}`} style={{ width: `${(c / max) * 100}%` }} />
              <span className="hbar-mark" style={{ left: `${((p.n / p.players) / max) * 100}%` }} />
            </span>
            <span className="hbar-value">{pct(c / p.n, 0)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CloseGames({ games }: { games: PlayerGame[] }) {
  const c = closeness(games);
  const duel = games.every((g) => g.players === 2);
  if (c.losses + c.wins < 10) return null;
  return (
    <Card title="Close games" sub="How far you were from the winner. Games where you quit are left out.">
      <div className="insights">
        <Insight value={`${c.oneShort} of ${c.losses}`}>losses were by a <strong>single VP</strong>. Those are the games one more card or road would have won.</Insight>
        <Insight value={fixed(c.avgShort, 1)}>VP short of the winner, on average, when you lose.</Insight>
        <Insight value={`${c.clutch} of ${c.wins}`}>wins came with {duel ? "your opponent" : "the runner-up"} <strong>one VP behind</strong>.</Insight>
      </div>
    </Card>
  );
}

function PaceCard({ games }: { games: PlayerGame[] }) {
  const rows = byPace(games);
  if (rows.every((r) => r.rec.n === 0)) return null;
  return (
    <Card title="By game length" sub="Your games split into thirds by turn count, within each queue. Do you close out fast, or win the long grind?">
      <RateRows rows={rows.map((r) => ({ label: `${r.pace} games`, rec: r.rec, hint: r.rec.n ? `${r.turns[0]}–${r.turns[1]} turns` : undefined }))} />
    </Card>
  );
}

function SeatCard({ games }: { games: PlayerGame[] }) {
  const players = placements(games).players;
  const seats = bySeat(games, players);
  if (seats.every((s) => !s.n)) return null;
  return (
    <Card title="By seat" sub={`Play order in ${players}-player games.`}>
      <RateRows rows={seats.map((rec, i) => ({ label: <><SeatBadge n={i + 1} />{players === 2 ? (i === 0 ? "Going first" : "Going second") : i === 0 ? "First" : `Seat ${i + 1}`}</>, rec }))} />
    </Card>
  );
}

// --- Habits -----------------------------------------------------------------

function Activity({ games }: { games: PlayerGame[] }) {
  const days = perDay(games, 30);
  const active = days.filter((d) => d.games).length;
  const grid = weekGrid(games.map((g) => g.t));
  const span = games.length ? (games[0].t - games[games.length - 1].t) / 86400 : 0;
  return (
    <Card title="When you play" sub={`Your last ${games.length} games${span >= 1 ? ` over ${fixed(span, 0)} days` : ""}, in your local time.`}>
      <WeekHeatmap grid={grid} />
      <h3>Last 30 days <small className="muted">{active} active day{active === 1 ? "" : "s"}</small></h3>
      <BarChart
        label="Games per day, last 30 days"
        height={120}
        bins={days.map((d) => ({
          label: d.day.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
          value: d.games,
          tip: `${d.day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${d.games} games, ${d.wins} wins`,
        }))}
      />
    </Card>
  );
}

function Tilt({ games }: { games: PlayerGame[] }) {
  const s = sessions(games);
  const parts = byDayPart(games);
  const overall = record(games);
  const loss = s.afterLoss, win = s.afterWin;
  const tilted = loss.n >= 10 && win.n >= 10 && rate(loss) < rate(win) - 0.05;
  return (
    <Card
      title="Momentum & time of day"
      sub={`${s.count} sessions (a break of 45+ minutes starts a new one), ${fixed(s.avgGames, 1)} games each on average, longest ${s.longest}.`}
    >
      {loss.n >= 10 && win.n >= 10 && (
        <p className={`callout ${tilted ? "neg" : ""}`}>
          {tilted
            ? <>You win <strong>{pct(rate(loss), 0)}</strong> of games straight after a loss, against <strong>{pct(rate(win), 0)}</strong> after a win. Consider a break after a loss.</>
            : <>Losses don't seem to carry over: you win {pct(rate(loss), 0)} after a loss and {pct(rate(win), 0)} after a win.</>}
        </p>
      )}
      <RateRows
        rows={[
          { label: "Overall", rec: overall },
          { label: "First game of a session", rec: s.first },
          { label: "After a win", rec: s.afterWin },
          { label: "After a loss", rec: s.afterLoss },
          { label: "After 2+ losses in a row", rec: s.afterTwoLosses },
          { label: "4th+ game of a session", rec: s.late },
        ]}
      />
      <h3>Time of day <small className="muted">your local time</small></h3>
      <RateRows rows={parts.map((p) => ({ label: `${p.name} (${p.from}:00–${p.to}:00)`, rec: p.rec }))} />
    </Card>
  );
}

// --- Opponents & history ----------------------------------------------------

function Rivals({ games, me }: { games: PlayerGame[]; me: string }) {
  const rows = useMemo(() => rivals(games, me).filter((r) => r.games >= 2).slice(0, 12), [games, me]);
  if (!rows.length) return null;
  return (
    <Card title="Head to head" sub="Humans you've met in 2+ recent games. ‘Finished above’ counts games where you placed higher.">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Player</th><th className="num">Games</th><th className="num">Finished above</th><th className="num">Your wins</th><th className="num">Their wins</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const share = r.above / r.games;
              return (
                <tr key={r.id}>
                  <td className="name">
                    <Link to={playerPath(r.name)}>{r.name}</Link>
                    {r.games >= 3 && share <= 0.34 && <span className="tag neg" data-tip="You finish below them most of the time">nemesis</span>}
                    {r.games >= 3 && share >= 0.67 && <span className="tag pos" data-tip="You finish above them most of the time">favourable</span>}
                  </td>
                  <td className="num">{r.games}</td>
                  <td className="num"><strong>{r.above}</strong> <small>{pct(share, 0)}</small></td>
                  <td className="num">{r.myWins}</td>
                  <td className="num">{r.theirWins}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PlayersCell({ roster, me }: { roster: HistoryPlayer[]; me: string }) {
  const sorted = [...roster].sort((a, b) => a.rank - b.rank);
  return (
    <span className="players">
      {sorted.map((p) => {
        const c = PLAYER_COLORS[p.playerColor];
        const self = p.userId === me;
        return (
          <span key={p.userId} className={`pl ${self ? "self" : ""}`} data-tip={`${ordinal(p.rank)} · ${p.points} VP${p.quitWithPenalty ? " · quit" : ""}${p.isHuman ? "" : " · bot"}`}>
            <Swatch hex={c?.hex ?? "#888"} />
            {self || !p.isHuman || p.username === "Deleted User" ? p.username : <Link to={playerPath(p.username)}>{p.username}</Link>}
          </span>
        );
      })}
    </span>
  );
}

function MatchHistory({ games, me, maps }: { games: PlayerGame[]; me?: string; maps?: Map<string, number> }) {
  const [shown, setShown] = useState(20);
  const [queue, setQueue] = useState<number | "all">("all");
  const queues = byQueue(games);
  const list = queue === "all" ? games : games.filter((g) => g.queue === queue);
  const live = me != null;
  return (
    <Card>
      <div className="card-head">
        <h2>Match history <small className="muted">{list.length} games</small></h2>
        {queues.length > 1 && (
          <div className="chip-row" aria-label="Filter by queue">
            <button className={`chip ${queue === "all" ? "on" : ""}`} onClick={() => setQueue("all")}>All</button>
            {queues.map((q) => (
              <button key={q.queue} className={`chip ${queue === q.queue ? "on" : ""}`} onClick={() => setQueue(q.queue)}>
                {label(QUEUES, q.queue)} <small>{q.rec.n}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>Result</th><th>Queue</th><th className="num">VP</th><th className="num">Seat</th><th className="num">Turns</th>
              {live && <th className="num">Length</th>}
              {live && <th>Players</th>}
              <th className="num">When</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, shown).map((g) => (
              <tr key={g.id} className={g.won ? "row-win" : ""}>
                <td><span className={`place ${g.won ? "place-win" : g.rank === g.players ? "place-last" : ""}`}>{placeLabel(g.rank, g.players)}</span>{g.quit && <span className="tag neg">quit</span>}</td>
                <td>{label(QUEUES, g.queue)}{maps?.get(g.id) ? <small className="muted"> · {mapName(maps.get(g.id)!)}</small> : null}</td>
                <td className="num">{g.vp}{g.target ? <small>/{g.target}</small> : null}</td>
                <td className="num">{g.order || "–"}</td>
                <td className="num">{g.turns}</td>
                {live && <td className="num">{g.dur ? duration(g.dur) : "–"}</td>}
                {live && <td>{g.roster && <PlayersCell roster={g.roster} me={me} />}</td>}
                <td className="num muted" data-tip={new Date(g.t * 1000).toLocaleString()}>{ago(g.t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown < list.length && <p><button className="btn ghost" onClick={() => setShown((n) => n + 40)}>Show more</button></p>}
    </Card>
  );
}

// --- Ranked -----------------------------------------------------------------

function RankedCard({ m }: { m: RankedMode }) {
  const state = m.currentRankedState;
  const placement = state?.type === 0 && state.numberOfPlacementGamesRequired;
  const div = state?.currentDivisionState;
  const rating = Number(m.skillRating);
  const lo = div?.demotionDivisionBoundary?.boundary;
  const hi = div?.promotionDivisionBoundary?.boundary;
  const progress = lo != null && hi != null && hi > lo && Number.isFinite(rating) ? Math.min(1, Math.max(0, (rating - lo) / (hi - lo))) : null;
  const unplayed = m.winRate === "-";

  return (
    <div className={`rank-card ${unplayed ? "unplayed" : ""}`}>
      <div className="rank-head">
        <strong>{m.modeName}</strong>
        <span className="muted">{placement ? `Placement ${state?.numberOfPlacementGamesFinished ?? 0}/${placement}` : unplayed ? "" : divisionName(m.division, m.subdivision)}</span>
      </div>
      <div className="rank-rating">{m.skillRating === "-" ? "–" : int(rating)}</div>
      <div className="muted rank-sub">{unplayed ? "Not played this season" : `${m.winRate}% win · ${m.gamesPlayed} games`}</div>
      {progress != null && (
        <>
          <div className="progress" data-tip={`${int(lo!)} demotion · ${int(hi!)} promotion`}>
            <span style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="muted rank-sub">{int(hi! - rating)} to promotion</div>
        </>
      )}
      {m.rankedStanding && m.rankedStanding.some((s) => s.rank !== "-") && (
        <ul className="standings">
          {m.rankedStanding.filter((s) => s.rank !== "-").map((s, i) => (
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
        {(r) => {
          // Played modes first, so the cards a player cares about lead.
          const modes = [...r.modes].sort((a, b) => Number(a.winRate === "-") - Number(b.winRate === "-"));
          return <div className="rank-grid">{modes.map((m) => <RankedCard key={m.modeType + m.modeName} m={m} />)}</div>;
        }}
      </Loaded>
    </Card>
  );
}

// --- Page -------------------------------------------------------------------

function Ladders({ modes }: { modes?: PlayerSummary["modes"] }) {
  const list = Object.entries(modes ?? {});
  if (!list.length) return null;
  return (
    <div className="chip-row">
      {list.map(([m, r]) => (
        <Link key={m} className="chip" to={`/leaderboard/${m}`}>{LEADERBOARD_MODES[m] ?? m} <small>#{int(r.rank)} · {int(r.rating)}</small></Link>
      ))}
    </div>
  );
}

/** [players, games] per table size, most played first. */
function formatCounts(games: PlayerGame[]): [number, number][] {
  const by = new Map<number, number>();
  for (const g of games) by.set(g.players, (by.get(g.players) ?? 0) + 1);
  return [...by.entries()].sort((a, b) => b[1] - a[1]);
}

/** Splits 1v1 from 4P, since places, VP and seats mean different things in each.
 *  Defaults to the format the player plays most; kept in the URL as ?p=. */
function useFormat(games: PlayerGame[]) {
  const [params, setParams] = useSearchParams();
  const formats = formatCounts(games);
  const raw = params.get("p");
  const selected: number | "all" = raw === "all" ? "all" : formats.some(([p]) => String(p) === raw) ? Number(raw) : (formats[0]?.[0] ?? "all");
  const select = (p: number | "all") => setParams(p === formats[0]?.[0] ? {} : { p: String(p) }, { replace: true });
  const shown = selected === "all" ? games : games.filter((g) => g.players === selected);
  return { formats, selected, select, shown };
}

function FormatFilter({ formats, selected, select, total }: ReturnType<typeof useFormat> & { total: number }) {
  if (formats.length < 2) return null;
  return (
    <div className="filters">
      <div className="filter-group">
        <span className="filter-label">Format</span>
        <div className="chip-row" aria-label="Game format">
          {formats.map(([p, n]) => (
            <button key={p} className={`chip ${selected === p ? "on" : ""}`} onClick={() => select(p)}>{formatName(p)} <small>{n}</small></button>
          ))}
          <button className={`chip ${selected === "all" ? "on" : ""}`} onClick={() => select("all")}>All <small>{total}</small></button>
        </div>
      </div>
    </div>
  );
}

function Analysis({ games: all, name, userId, maps }: { games: PlayerGame[]; name?: string; userId?: string; maps?: Map<string, number> }) {
  const format = useFormat(all);
  const games = format.shown;
  if (!all.length) return <Empty>No finished games in this player's recent history.</Empty>;
  const duel = games.every((g) => g.players === 2);
  return (
    <>
      <FormatFilter {...format} total={all.length} />
      <Summary games={games} />
      <Card title="Recent form" sub={`Newest first. W = win, ${duel ? "L = loss" : "numbers are finishing places"}.`}>
        <FormStrip games={games.slice(0, 30)} />
      </Card>
      {name && <RankedSection name={name} />}

      <h2 className="section-title">Performance</h2>
      <QueueTable games={games} />
      <div className="split even">
        <Placements games={games} />
        <SeatCard games={games} />
      </div>
      <div className="split even">
        <CloseGames games={games} />
        <PaceCard games={games} />
      </div>

      <h2 className="section-title">Habits</h2>
      <div className="split even">
        <Activity games={games} />
        <Tilt games={games} />
      </div>

      <h2 className="section-title">Games</h2>
      {userId && <Rivals games={games} me={userId} />}
      <MatchHistory games={games} me={userId} maps={maps} />
    </>
  );
}

function LivePlayer({ name, snapshot }: { name: string; snapshot?: PlayerSummary }) {
  const state = useAsync(() => Promise.all([api.player(name), api.history(name)]), [name]);
  const games = useMemo(() => (state.status === "ready" ? fromHistory(state.data[1]) : []), [state]);

  if (state.status === "error") {
    const e = state.error;
    if (e instanceof ApiError && e.status === 404) return <Empty>No colonist.io player called “{name}”. Check the spelling. Names are case-insensitive.</Empty>;
    if (snapshot) return <SnapshotPlayer p={snapshot} note={`Live data unavailable (${e.message}). Showing the latest snapshot instead.`} />;
    return <Empty>Couldn't load live data: {e.message}</Empty>;
  }
  if (state.status === "loading") return <p className="muted loading">Loading {name}…</p>;

  const [profile, history] = state.data;
  const maps = new Map(history.gameDatas.filter((g) => g.setting.mapSetting !== 0).map((g) => [g.id, g.setting.mapSetting]));
  return (
    <>
      <header className="page-head">
        <h1>{profile.country && <span className="flag">{flag(profile.country)}</span>}{profile.username}</h1>
        <p className="muted">
          {int(profile.gameData.totalGames)} lifetime games · karma {profile.karma} · live from colonist.io
        </p>
        <Ladders modes={snapshot?.modes} />
      </header>
      <Analysis games={games} name={profile.username} userId={history.profileUserId} maps={maps} />
    </>
  );
}

function SnapshotPlayer({ p, note }: { p: PlayerSummary; note: string }) {
  const games = useMemo(() => fromSnapshot(p), [p]);
  return (
    <>
      <header className="page-head">
        <h1>{p.u}</h1>
        <p className="muted">{note}</p>
        <Ladders modes={p.modes} />
      </header>
      <Analysis games={games} />
    </>
  );
}

export function PlayerPage() {
  const name = (useParams().name ?? "").slice(0, 40);
  useTitle(name);
  const players = useAsync(() => loadPlayers().catch(() => ({}) as Record<string, PlayerSummary>));
  return (
    <Loaded state={players}>
      {(all) => {
        const snap = all[name.toLowerCase()];
        if (apiEnabled) return <LivePlayer key={name} name={name} snapshot={snap} />;
        if (snap) return <SnapshotPlayer p={snap} note={`Last ${snap.recent.length} games from the daily snapshot (leaderboard players only).`} />;
        return <Empty>“{name}” isn't in the snapshot, and live lookups aren't enabled on this site. Only leaderboard players can be shown.</Empty>;
      }}
    </Loaded>
  );
}
