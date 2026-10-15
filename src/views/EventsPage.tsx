import { api, apiEnabled, i18n, type Championship } from "../api";
import { Card, Empty, Loaded } from "../components";
import { useAsync } from "../hooks";

const MODE_NAMES: Record<string, string> = {
  beginner: "Beginner vs bots",
  baseBots: "Classic vs bots",
  rushBots: "Rush vs bots",
  casual1v1: "Casual 1v1",
  casual4p: "Casual 4P",
  shuffle: "Shuffle",
  ranked1v1: "Ranked 1v1",
  ranked4p: "Ranked 4P",
  rankedRush: "Ranked Rush",
  rankedCitiesAndKnights: "Ranked Cities & Knights",
};

const safeUrl = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);

function Qualifiers({ data, edition }: { data: Championship; edition: number }) {
  const now = Date.now();
  const qs = [...(data.qualifiers ?? [])].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const upcoming = qs.filter((q) => Date.parse(q.date) >= now - 86400_000);
  const past = qs.filter((q) => Date.parse(q.date) < now - 86400_000).reverse();
  const row = (q: (typeof qs)[number], i: number) => {
    const href = safeUrl(q.joinUrl);
    return (
      <tr key={i}>
        <td>{new Date(q.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</td>
        <td className="name">{href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{q.title}</a> : q.title}</td>
        <td className="muted">{q.location}</td>
      </tr>
    );
  };
  return (
    <Card title={`Championship ’${edition} qualifiers`} sub={`${qs.length} events · ${data.partners?.length ?? 0} partner communities`}>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Event</th><th>Location</th></tr></thead>
          <tbody>
            {upcoming.length > 0 && <tr className="group"><td colSpan={3}>Upcoming</td></tr>}
            {upcoming.map(row)}
            {past.length > 0 && <tr className="group"><td colSpan={3}>Past</td></tr>}
            {past.slice(0, 15).map(row)}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Modes() {
  const state = useAsync(api.modes);
  return (
    <Loaded state={state}>
      {(m) => (
        <Card title="Game modes" sub={`Matchmaking queues and typical game length. Ranked unlocks after ${m.gamesToUnlockRanked ?? "?"} games.`}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Group</th><th>Mode</th><th className="num">Humans</th><th className="num">Bots</th><th className="num">Typical length</th></tr></thead>
              <tbody>
                {m.tabs.flatMap((t) =>
                  t.cards.map((c) => (
                    <tr key={c.modeId}>
                      <td className="muted">{t.tabId}</td>
                      <td className="name">{MODE_NAMES[c.modeId] ?? i18n(c.title)}</td>
                      <td className="num">{c.playerCount ?? "–"}</td>
                      <td className="num">{c.botCount ?? "–"}</td>
                      <td className="num">{c.estimatedTime ? `${c.estimatedTime}m` : "–"}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Loaded>
  );
}

function Championships() {
  const state = useAsync(() => Promise.all([api.championship(26), api.championship(25)]));
  return (
    <Loaded state={state}>
      {([c26, c25]) => (
        <>
          <Qualifiers data={c26} edition={26} />
          <Qualifiers data={c25} edition={25} />
        </>
      )}
    </Loaded>
  );
}

export function EventsPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Events &amp; modes</h1>
          <p className="muted">Live from colonist.io</p>
        </div>
      </header>
      {apiEnabled ? (
        <>
          <Championships />
          <Modes />
        </>
      ) : (
        <Empty>This page needs the live API, which isn't configured for this site.</Empty>
      )}
    </>
  );
}
