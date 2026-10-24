"use strict";

const { test, beforeEach, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "badge-transport-test-"));
process.env.BADGES_DATA_DIR = root;
const { PATHS } = require("../src/config");
Object.assign(PATHS, { vault: path.join(root, "vault.json"), journal: path.join(root, "journal.jsonl"),
  checkpoint: path.join(root, "checkpoint.json"), debugDir: path.join(root, "debug") });
const runtime = require("../src/runtime");
const http = require("../src/http");
const checkpoint = require("../src/checkpoint");
const vault = require("../src/vault");
const forge = require("../src/forge");
const originalFetch = global.fetch;
const originalSleep = runtime.sleep;
const originalLoad = vault.load;
const originalSave = vault.save;
let state, waits, requests, saves;

beforeEach(() => {
  runtime.configure({ offline: false });
  state = { token: `${Buffer.from("123456789").toString("base64url")}.test.secret`, analyticsToken: "ANALYTICS_SECRET",
    cookie: "COOKIE_SECRET", activeProfile: "default", totals: { titles: 0, hours: 0, runs: 0, streamHours: 0, varietyTitles: 0 },
    acceptedGameIds: [] };
  waits = []; requests = []; saves = 0;
  vault.load = () => state;
  vault.save = () => { saves++; };
  runtime.sleep = async (ms) => { runtime.signal().throwIfAborted(); waits.push(ms); };
  global.fetch = async (url, options) => { requests.push({ url: String(url), options }); return new Response(null, { status: 204 }); };
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root);
});
afterEach(() => { global.fetch = originalFetch; runtime.sleep = originalSleep; vault.load = originalLoad; vault.save = originalSave; });
after(() => fs.rmSync(root, { recursive: true, force: true }));

function responses(statuses) {
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const entry = statuses[Math.min(requests.length - 1, statuses.length - 1)];
    return typeof entry === "number" ? new Response(entry === 204 ? null : "{}", { status: entry }) : entry.clone();
  };
}
function sessionFor(game, hours = 1) {
  const properties = { game_id: game.id, game_session_id: `session-${game.id}` };
  return [
    { type: "running_game_heartbeat", properties: { ...properties, initial_heartbeat: true, duration_tracked_ms: 0 } },
    { type: "launch_game", properties: { game_id: game.id } },
    { type: "running_game_heartbeat", properties: { ...properties, final_heartbeat: true, duration_tracked_ms: hours * 3600000 } },
  ];
}
function pair(id, hours = 1) {
  const properties = { game_id: id, media_session_id: `stream-${id}` };
  return [{ type: "video_stream_started", properties },
    { type: "video_stream_ended", properties: { ...properties, duration_ms: hours * 3600000 } }];
}
const settings = { batchSize: 1, batchPauseMs: 0, maxRetries: 3 };

test("transport only allows official HTTPS endpoints and refuses redirects", async () => {
  for (const url of ["http://discord.com/api", "https://discord.com.evil.test/api", "https://evil.test", "https://secret@discord.com", "https://discord.com:444/api"]) {
    await assert.rejects(http.request(url), /restricted/);
  }
  assert.equal(requests.length, 0);
  await http.request("https://discord.com/api/v9/users/@me");
  assert.equal(requests[0].options.redirect, "error");
});

test("429 honors the greater JSON or Retry-After delay", async () => {
  responses([new Response('{\"retry_after\":1.75}', { status: 429, headers: { "retry-after": "0.5" } }), 204]);
  const result = await http.request("https://discord.com/api/v9/science", { method: "POST", maxRetries: 2 });
  assert.equal(result.status, 204);
  assert.deepEqual(waits, [1750]);
  assert.equal(requests.length, 2);
});

test("Retry-After HTTP dates parse correctly and excessive waits are not shortened", async () => {
  const now = Date.UTC(2026, 0, 1);
  const response = new Response("{}", { status: 429, headers: { "Retry-After": new Date(now + 60000).toUTCString() } });
  assert.equal(await http.retryAfterMs(response, now), 60000);
  responses([new Response('{\"retry_after\":3600}', { status: 429 })]);
  assert.equal((await http.request("https://discord.com/api", { maxRetries: 6 })).status, 429);
  assert.equal(requests.length, 1);
  assert.deepEqual(waits, []);
});

test("rate-limit retries are bounded and auth/client errors are never retried", async () => {
  responses([new Response('{\"retry_after\":0}', { status: 429 })]);
  await http.request("https://discord.com/api", { maxRetries: 100 });
  assert.equal(requests.length, 7);
  for (const status of [400, 401, 403, 404]) {
    requests = []; waits = [];
    responses([status]);
    assert.equal((await http.request("https://discord.com/api", { maxRetries: 6 })).status, status);
    assert.equal(requests.length, 1);
    assert.deepEqual(waits, []);
  }
});

test("POST server/network errors are not replayed and do not expose secrets", async () => {
  responses([500, 204]);
  assert.equal(await forge.postWithRetry(sessionFor({ id: "1" }), settings), 500);
  assert.equal(requests.length, 1);
  let count = 0;
  global.fetch = async () => { count++; throw new Error("TOKEN_SECRET endpoint?cookie=COOKIE_SECRET"); };
  await assert.rejects(http.request("https://discord.com/api", { method: "POST", maxRetries: 6 }), (error) => {
    assert.equal(error.code, "NETWORK_ERROR");
    assert.doesNotMatch(String(error), /TOKEN_SECRET|COOKIE_SECRET/);
    return true;
  });
  assert.equal(count, 1);
});

test("timeouts and cancellation abort requests", async () => {
  global.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  await assert.rejects(http.request("https://discord.com/api", { timeoutMs: 5 }), { code: "REQUEST_TIMEOUT" });
  const pending = http.request("https://discord.com/api", { timeoutMs: 5000 });
  runtime.cancel();
  await assert.rejects(pending, { name: "AbortError" });
});

test("offline and explicit dry run never load credentials, send, persist, or account", async () => {
  vault.load = () => { throw new Error("credentials were read"); };
  const builder = () => { throw new Error("event builder should not run in dry mode"); };
  const dry = await forge.runForges([{ id: "1" }], builder, { dryRun: true });
  assert.equal(dry.ok, 0);
  assert.equal(dry.planned, 1);
  assert.equal(dry.dryRun, true);
  const stream = await forge.runEventBatches(pair("1"), { dryRun: true });
  forge.recordRun(dry, 1, false);
  forge.recordRun(stream, 1, false, { mode: "stream", totalHours: 100 });
  assert.deepEqual(fs.readdirSync(root), []);
  assert.equal(requests.length, 0);
  runtime.configure({ offline: true });
  await assert.rejects(http.request("https://discord.com/api"), /disabled/);
  assert.equal(await forge.postScience([], {}), 0);
});

test("checkpoint fingerprint binds account/profile/mode/order/durations", () => {
  const input = { accountId: "123", profile: "default", mode: "playtime", gameIds: ["1", "2"], durationsMs: [1000, 2000] };
  const plan = checkpoint.createPlan(input);
  checkpoint.save({ plan, index: 1, total: 2 });
  assert.equal(checkpoint.resumeIndex(plan), 1);
  for (const change of [{ accountId: "456" }, { profile: "other" }, { mode: "variety" },
    { gameIds: ["2", "1"] }, { durationsMs: [1000, 3000] }]) {
    assert.equal(checkpoint.resumeIndex(checkpoint.createPlan({ ...input, ...change })), 0);
  }
  const saved = checkpoint.load();
  saved.plan.durationsMs[0] = 999;
  fs.writeFileSync(checkpoint.FILE, JSON.stringify(saved));
  assert.equal(checkpoint.load(), null);
});

test("offline checkpoint and journal inspection never access the filesystem", (t) => {
  runtime.configure({ offline: true });
  const denied = [];
  for (const method of ["readFileSync", "existsSync", "statSync", "readdirSync", "writeFileSync", "appendFileSync", "mkdirSync", "unlinkSync"]) {
    denied.push(t.mock.method(fs, method, () => { throw new Error(`Unexpected filesystem access: ${method}`); }));
  }
  assert.equal(checkpoint.load(), null);
  const plan = checkpoint.createPlan({ accountId: "123", profile: "default", mode: "playtime", gameIds: ["1"], durationsMs: [1000] });
  assert.equal(checkpoint.resumeIndex(plan), 0);
  assert.equal(checkpoint.save({ plan, index: 0, total: 1 }), false);
  checkpoint.clear();
  assert.deepEqual(forge.journalStats(), { rows: [], byMode: {}, ok: 0, fail: 0, hours: 0, total: 0 });
  forge.journalAppend({ mode: "dry" });
  assert.equal(forge.dumpDebug([], 204), null);
  for (const method of denied) assert.equal(method.mock.callCount(), 0);
});

test("failed batch stops immediately and resume starts exactly at the failed batch", async () => {
  const games = [{ id: "1" }, { id: "2" }, { id: "3" }];
  responses([204, 400, 204]);
  const first = await forge.runForges(games, sessionFor, settings, { resumeFrom: 99 });
  assert.equal(first.ok, 1);
  assert.equal(first.failed, 1);
  assert.equal(first.acceptedHours, 1);
  assert.deepEqual(first.acceptedIds, ["1"]);
  assert.equal(requests.length, 2);
  assert.equal(checkpoint.load().index, 1);
  requests = [];
  responses([204]);
  const second = await forge.runForges(games, sessionFor, settings);
  assert.equal(second.skipped, 1);
  assert.equal(second.ok, 2);
  assert.equal(second.acceptedHours, 2);
  assert.deepEqual(second.acceptedIds, ["2", "3"]);
  assert.equal(checkpoint.load(), null);
});

test("same-length different game plan never skips previous successes", async () => {
  responses([204, 401]);
  await forge.runForges([{ id: "1" }, { id: "2" }], sessionFor, settings);
  requests = [];
  responses([204]);
  const result = await forge.runForges([{ id: "3" }, { id: "4" }], sessionFor, settings);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.acceptedIds, ["3", "4"]);
});

test("streaming keeps pairs together and only credits accepted completed durations", async () => {
  responses([204, 403]);
  const result = await forge.runEventBatches([...pair("1", 2), ...pair("2", 5), ...pair("3", 8)], settings,
    { eventChunkSize: 3, label: "stream events" });
  assert.equal(result.eventOk, 2);
  assert.equal(result.completedSessions, 1);
  assert.equal(result.acceptedHours, 2);
  assert.deepEqual(result.acceptedIds, ["1"]);
  assert.equal(checkpoint.load().index, 2);
  forge.recordRun(result, 5, false, { mode: "stream", totalHours: 15 });
  assert.equal(state.totals.streamHours, 2);
  assert.equal(state.totals.titles, 0);
  assert.equal(forge.journalStats().hours, 2);
});

test("streaming refuses incomplete pairs before sending", async () => {
  await assert.rejects(forge.runEventBatches(pair("1").slice(0, 1), settings), /complete/);
  const mismatched = [...pair("1")];
  mismatched[1] = pair("2")[1];
  await assert.rejects(forge.runEventBatches(mismatched, settings), /incomplete/);
  assert.equal(requests.length, 0);
});

test("graceful cancellation retains accepted accounting and contiguous checkpoint", async () => {
  runtime.sleep = async () => { runtime.cancel(); runtime.signal().throwIfAborted(); };
  const result = await forge.runForges([{ id: "1" }, { id: "2" }], sessionFor, settings);
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, 1);
  assert.equal(result.acceptedHours, 1);
  assert.equal(checkpoint.load().index, 1);
  forge.recordRun(result, 1, false, { mode: "playtime" });
  assert.equal(state.totals.hours, 1);
});

test("variety totals deduplicate titles across accepted runs", () => {
  const summary = { ok: 2, failed: 0, batches: 1, acceptedIds: ["1", "2"], acceptedHours: 2, eventOk: 6 };
  forge.recordRun(summary, 1, false, { mode: "playtime" });
  forge.recordRun({ ...summary, acceptedIds: ["2", "3"] }, 1, false, { mode: "variety" });
  assert.equal(state.totals.titles, 3);
  assert.equal(state.totals.varietyTitles, 3);
  assert.equal(state.totals.hours, 4);
  assert.equal(saves, 2);
});

test("debug files are opt-in sanitized metadata and never contain event/account data", async () => {
  const events = [{ type: "launch_game", properties: { token: "TOKEN_SECRET", user: "USER_SECRET", path: "PRIVATE_PATH" } },
    { type: "EVENT_TYPE_SECRET", properties: {} }];
  responses([400]);
  await forge.postWithRetry(events, settings);
  assert.equal(fs.existsSync(PATHS.debugDir), false);
  await forge.postWithRetry(events, { ...settings, debugDump: true });
  const files = fs.readdirSync(PATHS.debugDir);
  assert.equal(files.length, 1);
  const content = fs.readFileSync(path.join(PATHS.debugDir, files[0]), "utf8");
  assert.doesNotMatch(content, /TOKEN_SECRET|USER_SECRET|PRIVATE_PATH|EVENT_TYPE_SECRET|COOKIE_SECRET|ANALYTICS_SECRET/);
  assert.deepEqual(JSON.parse(content).eventTypes, { launch_game: 1, other: 1 });
});
