import { loadMeta, type Meta } from "../data";
import { API_BASE, apiEnabled } from "../api";
import { Loaded } from "../components";
import { int } from "../format";
import { useAsync, useTitle } from "../hooks";

interface ApiIndex {
  routes: { path: string; upstream: string; description: string }[];
  excluded: string[];
}

function ApiStatus() {
  const state = useAsync<ApiIndex>(async () => {
    const res = await fetch(`${API_BASE}/v1`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  if (!apiEnabled) return <p><strong>Not configured.</strong> Player and leaderboard pages use the snapshot only.</p>;
  if (state.status === "loading") return <p className="muted">Checking {API_BASE}…</p>;
  if (state.status === "error") return <p><strong>Unreachable</strong> ({state.error.message}). Pages fall back to the snapshot where they can.</p>;
  return (
    <>
      <p><strong>Connected</strong> to <code>{API_BASE}</code>. It's a read-only, cached proxy for these public colonist.io endpoints:</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Route</th><th>What it returns</th></tr></thead>
          <tbody>
            {state.data.routes.map((r) => (
              <tr key={r.path}>
                <td><code>{r.path}</code></td>
                <td className="wrap">{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">Not available: {state.data.excluded.join("; ")}.</p>
    </>
  );
}

function AboutView({ meta }: { meta: Meta }) {
  return (
    <>
      <header className="page-head"><div><h1>About</h1></div></header>
      <section className="card prose">
        <h2>Where the data comes from</h2>
        <p>
          colonist.io has no documented public API, and it doesn't send CORS headers, so a browser can't query it directly.
          This site gets data two ways:
        </p>
        <ul>
          <li>
            <strong>Snapshot</strong> (Meta page): a scheduled GitHub Action reads the top {int(meta.topN)} players of each ranked ladder and their last 100 games.
            Games are de-duplicated and kept for {int(meta.retentionDays)} days. Last run: <strong>{new Date(meta.generatedAt).toLocaleString()}</strong>,
            with {int(meta.gamesTotal)} games from {int(meta.playersCrawled)} players.
          </li>
          <li><strong>Live API</strong> (player, leaderboard and events pages): our own small backend fetches colonist.io on demand and adds the CORS headers.</li>
        </ul>

        <h2>Live API</h2>
        <ApiStatus />

        <h2>How to read the stats</h2>
        <ul>
          <li><strong>Sample bias.</strong> Every snapshot game includes at least one top-ladder player, so these are high-rated games, not the whole population.</li>
          <li><strong>vs fair</strong> is the win rate minus the fair share (1 ÷ players), in percentage points. <strong>±</strong> is the 95% Wilson interval. Treat any gap inside the ± as noise.</li>
          <li><strong>Player insights</strong> (form, close games, momentum, head to head) come from the player's last 100 games, which is all colonist.io returns. Small groups are greyed out rather than hidden, so check the game counts.</li>
          <li><strong>Sessions</strong> on player pages start after a break of 45 minutes or more. Times are shown in your browser's time zone.</li>
          <li><strong>Tiers</strong>: S+ ≥ +4, S ≥ +2, A ≥ +0.75, B within ±0.75, C &gt; −2, D below that. A tier needs a minimum sample, and a Δ inside the 95% interval is always B.</li>
          <li>Turn order is missing on some older games. Those games are left out of the seat tables.</li>
        </ul>

        <p className="muted">Unofficial fan project. Not affiliated with colonist.io or Catan GmbH.</p>
      </section>
    </>
  );
}

export function AboutPage() {
  useTitle("About");
  const state = useAsync(loadMeta);
  return <Loaded state={state}>{(meta) => <AboutView meta={meta} />}</Loaded>;
}
