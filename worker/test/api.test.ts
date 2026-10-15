// Runs with Node's built-in test runner and TypeScript stripping (Node 24+).
// colonist.io is never contacted: global fetch is replaced per test.

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handle, type Env } from "../src/index.ts";

const env: Env = { ALLOWED_ORIGINS: "https://me.github.io" };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Reply = { status?: number; body: unknown; type?: string };
function mockUpstream(reply: (url: string) => Reply) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    assert.equal(init?.method ?? "GET", "GET");
    const h = new Headers(init?.headers);
    assert.equal(h.get("cookie"), null, "must never forward cookies");
    assert.equal(h.get("authorization"), null, "must never forward auth");
    const r = reply(url);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": r.type ?? "application/json; charset=utf-8" },
    });
  }) as typeof fetch;
  return calls;
}

const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  handle(new Request(`https://api.test${path}`, { method, headers }), env);

describe("routing and upstream mapping", () => {
  it("lists routes at /v1", async () => {
    const res = await get("/v1");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { routes: { path: string }[] };
    assert.ok(body.routes.some((r) => r.path === "/v1/players/:name/history"));
  });

  it("maps leaderboard queries to colonist's range and tab format", async () => {
    const calls = mockUpstream(() => ({ body: [] }));
    const res = await get("/v1/leaderboards/Classic4P?start=101&limit=50&country=au");
    assert.equal(res.status, 200);
    assert.equal(calls[0], "https://colonist.io/api/leaderboards/Classic4P/Country/AU?start=101&end=150");
  });

  it("defaults ranked to the current season", async () => {
    const calls = mockUpstream((u) =>
      u.endsWith("/ranked-seasons") ? { body: [{ seasonType: 21 }, { seasonType: 20 }] } : { body: [{ modeName: "1v1" }] },
    );
    const res = await get("/v1/players/Some%20One/ranked");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { seasonType: 21, modes: [{ modeName: "1v1" }] });
    assert.equal(calls[1], "https://colonist.io/api/profile/Some%20One/ranked/21");
  });

  it("merges overview and profile info, dropping isLoggedIn", async () => {
    mockUpstream((u) =>
      u.endsWith("/overview") ? { body: { userId: "1", username: "A" } } : { body: { username: "A", country: "AU", isLoggedIn: true } },
    );
    const body = (await (await get("/v1/players/A")).json()) as Record<string, unknown>;
    assert.equal(body.country, "AU");
    assert.equal("isLoggedIn" in body, false);
  });

  it("returns [] when a leaderboard search has no entries", async () => {
    mockUpstream(() => ({ status: 400, body: { error: { description: { key: "strings:x.noEntries" } } } }));
    const res = await get("/v1/leaderboards/Classic1v1/search?q=nobody");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });
});

describe("validation", () => {
  for (const path of [
    "/v1/players/.../history",
    "/v1/players/%2E%2E/history",
    "/v1/players/a%2Fb",
    "/v1/players/<script>",
    "/v1/leaderboards/Bogus",
    "/v1/leaderboards/Classic4P?limit=101",
    "/v1/leaderboards/Classic4P?country=USA",
    "/v1/leaderboards/Classic4P?country=US&continent=NA",
    "/v1/players/a/ranked/abc",
    "/v1/championship/24",
    "/v1/leaderboards/Classic4P/search?q=a",
  ]) {
    it(`rejects ${path} without calling upstream`, async () => {
      const calls = mockUpstream(() => ({ body: {} }));
      const res = await get(path);
      assert.ok(res.status === 400 || res.status === 404, `got ${res.status}`);
      assert.equal(calls.length, 0);
    });
  }

  it("404s unknown routes", async () => {
    assert.equal((await get("/v1/replay/data-from-game-id")).status, 404);
  });

  it("405s non-GET methods", async () => {
    assert.equal((await get("/v1/seasons", {}, "POST")).status, 405);
  });
});

describe("upstream errors", () => {
  it("maps noPlayerWithName to 404", async () => {
    mockUpstream(() => ({ status: 400, body: { error: { description: { key: "strings:popups.errors.userProfileError.noPlayerWithName" } } } }));
    const res = await get("/v1/players/ghost/history");
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "player_not_found");
  });

  it("rejects HTML served for unknown upstream paths", async () => {
    mockUpstream(() => ({ body: "<!doctype html>", type: "text/html" }));
    assert.equal((await get("/v1/seasons")).status, 502);
  });

  it("maps upstream 401 to 502 without leaking details", async () => {
    mockUpstream(() => ({ status: 401, body: { secret: "x" } }));
    const res = await get("/v1/seasons");
    assert.equal(res.status, 502);
    assert.ok(!(await res.text()).includes("secret"));
  });
});

describe("CORS", () => {
  it("echoes allowed origins only", async () => {
    mockUpstream(() => ({ body: [] }));
    const ok = await get("/v1/seasons", { Origin: "https://me.github.io" });
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://me.github.io");
    const no = await get("/v1/seasons", { Origin: "https://evil.example" });
    assert.equal(no.headers.get("access-control-allow-origin"), null);
  });

  it("answers preflight for allowed origins, 403 otherwise", async () => {
    assert.equal((await get("/v1/seasons", { Origin: "https://me.github.io" }, "OPTIONS")).status, 204);
    assert.equal((await get("/v1/seasons", { Origin: "https://evil.example" }, "OPTIONS")).status, 403);
  });
});
