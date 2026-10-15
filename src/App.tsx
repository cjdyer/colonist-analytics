import { useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Empty, Tooltip } from "./components";
import { playerPath } from "./format";
import { MetaPage } from "./views/MetaPage";
import { LeaderboardPage } from "./views/LeaderboardPage";
import { PlayerPage } from "./views/PlayerPage";
import { AboutPage } from "./views/AboutPage";
import { EventsPage } from "./views/EventsPage";

function PlayerSearch() {
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim().slice(0, 40);
    if (!n) return;
    navigate(playerPath(n));
    setName("");
  };
  return (
    <form className="search" role="search" onSubmit={submit}>
      <input type="search" placeholder="Player name…" aria-label="Search player" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
    </form>
  );
}

export function App() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/">
            <span className="hex" aria-hidden="true" />
            Colonist<b>Analytics</b>
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Meta</NavLink>
            <NavLink to="/leaderboard/Classic4P" className={() => (pathname.startsWith("/leaderboard") ? "active" : "")}>Leaderboards</NavLink>
            <NavLink to="/events">Events</NavLink>
            <NavLink to="/about">About</NavLink>
          </nav>
          <PlayerSearch />
        </div>
      </header>
      <main className="container" aria-live="polite">
        <Routes>
          <Route path="/" element={<MetaPage />} />
          <Route path="/leaderboard/:mode?" element={<LeaderboardPage />} />
          <Route path="/player/:name" element={<PlayerPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Empty>Page not found. <Link to="/">Go home</Link></Empty>} />
        </Routes>
      </main>
      <footer className="container footer muted">Unofficial fan project. Not affiliated with colonist.io.</footer>
      <Tooltip />
    </>
  );
}
