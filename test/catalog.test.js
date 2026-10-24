"use strict";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "badges-catalog-test-"));
process.env.BADGES_DATA_DIR = tempRoot;
const { PATHS } = require("../src/config");
const runtime = require("../src/runtime");
const games = require("../src/games");
assert.equal(path.resolve(PATHS.gameList), path.join(tempRoot, "games.json"));

function entry(id, extra = {}) {
  return { id, name: `Game ${id}`, executables: [{ os: "win32", name: `game-${id}.exe` }], ...extra };
}
beforeEach((t) => {
  runtime.configure({ offline: false });
  if (fs.existsSync(PATHS.gameList)) fs.unlinkSync(PATHS.gameList);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call in catalog test"); });
});
after(() => {
  assert.equal(path.dirname(path.resolve(tempRoot)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(tempRoot).startsWith("badges-catalog-test-"));
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("catalog parser handles missing collections and rejects invalid JSON", () => {
  for (const raw of ["null", "{}", "[]", "true"]) assert.deepEqual(games.parseCatalog(raw), []);
  assert.throws(() => games.parseCatalog("{truncated"), SyntaxError);
});

test("malformed catalog rows cannot discard valid games or introduce rounded IDs", () => {
  const raw = JSON.stringify([
    null, "bad", entry("no-id"), entry(Number.MAX_SAFE_INTEGER + 1),
    entry("10", { executables: {} }), entry("11", { executables: [null] }),
    entry("12", { executables: [{ os: "linux", name: "game" }] }),
    entry("13", { name: 123 }), entry("14", { name: { title: "bad" } }),
    entry("15", { executables: [{ os: "win32", name: 123 }] }),
    entry("16", { executables: [{ os: "win32", name: { path: "bad" } }] }),
    entry("17", { executables: [{ os: "win32", name: "" }] }),
    entry("18", { name: "Good", executables: [null, { os: "win32", name: "good.exe" }] }),
    entry("18", { name: "Duplicate" }), entry("19"),
  ]);
  const result = games.parseCatalog(raw);
  assert.deepEqual(result.map((game) => game.id), ["18", "19"]);
  assert.equal(result[0].name, "Good");
  assert.ok(result.every((game) => typeof game.name === "string" && typeof game.exe === "string"));
});

test("filters distinguish explicit verification, Windows executables, Steam and launchers", () => {
  const catalog = games.parseCatalog(JSON.stringify([
    entry("1", { verified: true, distributors: ["steam"] }),
    entry("2", { verified: "true" }),
    entry("3", { name: "Store Launcher", verified: false }),
    entry("4", { executables: [{ os: "darwin", name: "app" }, { os: "win32", name: "windows.exe" }] }),
  ]));
  assert.deepEqual(games.applyFilter(catalog, "verified").map((g) => g.id), ["1"]);
  assert.deepEqual(games.applyFilter(catalog, "steam").map((g) => g.id), ["1"]);
  assert.deepEqual(games.applyFilter(catalog, "no-launcher").map((g) => g.id), ["1", "2", "4"]);
  assert.equal(catalog.find((g) => g.id === "4").exe, "windows.exe");
  assert.deepEqual(games.searchGames(catalog, "  store ").map((g) => g.id), ["3"]);
});

test("offline catalog is fictional and requires neither filesystem nor network", async (t) => {
  runtime.configure({ offline: true });
  for (const name of ["existsSync", "readFileSync", "writeFileSync", "mkdirSync"]) {
    t.mock.method(fs, name, () => { throw new Error(`Unexpected offline filesystem access: ${name}`); });
  }
  const catalog = await games.loadGames();
  assert.ok(catalog.length >= 100);
  assert.equal(new Set(catalog.map((g) => g.id)).size, catalog.length);
  assert.ok(catalog.every((g) => g.demo === true && /^Demo Game /.test(g.name)));
  assert.equal(globalThis.fetch.mock.calls.length, 0);
  for (const name of ["existsSync", "readFileSync", "writeFileSync", "mkdirSync"]) assert.equal(fs[name].mock.calls.length, 0);
});

test("valid cached live catalog is used without network", async () => {
  fs.writeFileSync(PATHS.gameList, JSON.stringify([entry("123")]));
  const result = await games.loadGames();
  assert.deepEqual(result.map((g) => g.id), ["123"]);
  assert.ok(result.every((g) => !g.demo));
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test("corrupt cache is replaced using an unauthenticated official CDN request", async (t) => {
  fs.writeFileSync(PATHS.gameList, "truncated");
  const catalog = JSON.stringify([entry("123")]);
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).host, "cdn.discordapp.com");
    const headers = new Headers(options.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
    return new Response(catalog, { status: 200 });
  });
  assert.deepEqual((await games.loadGames()).map((g) => g.id), ["123"]);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(PATHS.gameList, "utf8")), JSON.parse(catalog));
});

test("failed live download never falls back to fictional demo records", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  assert.deepEqual(await games.loadGames(), []);
});
