# Colonist Analytics

A bare-bones [lolalytics](https://lolalytics.com/)-style stats site for [colonist.io](https://colonist.io): a React + Vite front-end on GitHub Pages, plus a small Cloudflare Worker API for live data.

- **Meta** (snapshot): headline takeaways, turn order tier list (win rate vs. fair share, 95% intervals), seat win rate by game length, winning margins and VP by finishing place, busiest hours, top players in form, and game length. Filter by queue, time window and quitters.
- **Leaderboards** (live): every ranked ladder, paged 100 at a time, filtered globally, by continent or by country, with name search.
- **Players** (live): profile and per-season ranked stats, plus insights from the last 100 games: recent form and streak, results by queue, finishing places, seat, game length, close games (losses by 1 VP), activity heatmap, momentum after wins/losses and by time of day, head-to-head records, and a filterable match history.
- **Events** (live): Colonist Championship qualifiers and matchmaking modes.

Without the API configured, the leaderboard and player pages fall back to the snapshot.

## Why there's a backend

colonist.io's JSON endpoints work, but they don't send `Access-Control-Allow-Origin`. A browser on `github.io` can send the request, but it won't let your JavaScript read the response. Only a server can, so:

```
                      ┌──────────── GitHub Pages (static React) ────────────┐
browser ──────────────┤  Meta page  ← public/data/*.json (daily snapshot)   │
   │                  └─────────────────────────────────────────────────────┘
   │ fetch (CORS ok)
   ▼
Cloudflare Worker (worker/) ──GET, no cookies, edge-cached──▶ colonist.io/api/*
```

## Live API (`worker/`)

A read-only, allowlisted proxy. It is not an open proxy: only the routes below exist, every parameter is validated, and nothing but anonymous GETs reach colonist.io. `GET /v1` returns this list as JSON.

| Route | colonist.io endpoint | Cache |
|---|---|---|
| `/v1/seasons` | `/api/profile/ranked-seasons` | 6 h |
| `/v1/modes` | `/api/mode-selector` | 1 h |
| `/v1/championship/:edition` (25, 26) | `/api/championship{NN}/content` | 1 h |
| `/v1/leaderboards/:mode?start=&limit=&country=\|continent=` | `/api/leaderboards/{mode}/{tab}` | 5 min |
| `/v1/leaderboards/:mode/search?q=` | `/api/leaderboards-username-search/{mode}/{tab}` | 5 min |
| `/v1/leaderboards/:mode/tabs` | `/api/leaderboards-tabs/{i}` | 1 h |
| `/v1/players/:name` | `/api/profile/{name}/overview` + `/sticky-player-info` | 2 min |
| `/v1/players/:name/history` | `/api/profile/{name}/history` (last 100 games; no paging upstream) | 2 min |
| `/v1/players/:name/ranked/:seasonType?` | `/api/profile/{name}/ranked/{seasonType}` | 5 min |
| `/v1/players/:name/items` | `/api/profile/{name}/items` | 1 h |

Modes: `Classic4P`, `Classic1v1`, `CitiesAndKnights4P`, `Rush4P` (and `Seafarerers4P`, colonist's spelling, currently inactive). Continents: `AF AN AS EU NA OC SA`.

**Not available**, because colonist requires a login or the request changes state: replays (`/api/replay/*`), friends leaderboards, notifications, user state, and every POST endpoint.

Safeguards:
- **Origins:** CORS only for origins listed in `ALLOWED_ORIGINS`.
- **Rate limit:** 60 requests per minute per IP, using the Workers Rate Limiting binding.
- **Requests to colonist:** 15 s timeout, 2 MB response cap, redirects refused, and the final URL is re-checked to stay under `colonist.io/api/`.
- **Errors:** generic error bodies only; colonist's messages aren't passed through.

### Run locally

Requires Node 24 (see `.nvmrc`).

```bash
nvm use
npm install && (cd worker && npm install)

# terminal 1: API on :8787
cd worker && npm run dev

# terminal 2: site on :5173 (uses http://localhost:8787 automatically in dev)
npm run dev
```

Worker tests (no network, colonist is mocked): `cd worker && npm test`.

## Snapshot crawler (`scripts/crawl.mjs`)

The Meta page needs thousands of games, so it reads a daily snapshot instead of live calls. A scheduled Action pulls the top `TOP_N` players of each ladder and their last 100 games, de-duplicates by game id, keeps `RETENTION_DAYS`, and commits `public/data/*.json`. `games.json` stores no usernames.

```bash
TOP_N=50 npm run crawl
```

Env: `TOP_N` (200), `DELAY_MS` (350), `CONCURRENCY` (2), `RETENTION_DAYS` (60), `MAX_GAMES` (60000).

> **Sample bias:** every snapshot game includes at least one top-ladder player, so read the Meta numbers as "high-rated games".

## Deploy

**API (Cloudflare):**
1. Create a Cloudflare API token with only the *Edit Cloudflare Workers* permission, scoped to your account.
2. Add the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Add the repo variable `API_ALLOWED_ORIGINS`, e.g. `https://<user>.github.io`.
4. Push to `main` (or run **Actions → API worker**). Note the `*.workers.dev` URL it prints.

**Site (GitHub Pages):**
1. Add the repo variable `API_BASE_URL` = the Worker URL. Leave it unset for a snapshot-only site.
2. Set **Settings → Pages → Source** to **GitHub Actions**.
3. Set **Settings → Actions → General → Workflow permissions** to **Read and write**, so the crawl can commit.
4. Run **Actions → Crawl & deploy** once. After that it runs daily, and every push to `main` redeploys.

The production build's CSP only allows `connect-src` to the site itself and `API_BASE_URL`.

## Notes

- This is an unofficial fan project, not affiliated with colonist.io. The endpoints are undocumented and may change or disappear; the API returns `502 upstream_*` errors when that happens.
- Usernames and other colonist-supplied strings are untrusted. React escapes them (there's no `dangerouslySetInnerHTML`), and only `https:` links from colonist data are rendered.
