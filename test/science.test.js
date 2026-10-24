"use strict";

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const runtime = require("../src/runtime");
const vault = require("../src/vault");
const science = require("../src/science");
const game = { id: "123456789", name: "Test Game", exe: "test.exe", verified: true };
const anotherGame = { id: "987654321", name: "Second Game", exe: "second.exe", verified: true };

beforeEach((t) => {
  runtime.configure({ offline: true });
  vault.resetForTests();
  science.bindSession("test-heartbeat", "test-launch", "e30=");
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Science construction must never access the network"); });
});

test("game session timestamps and duration remain coherent even when the clock advances", (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now++);
  const events = science.buildSessionTriplet(game, 60_000);
  const [opened, launched, closed] = events.map((event) => event.properties);
  assert.equal(opened.game_session_id, closed.game_session_id);
  assert.equal(opened.initial_heartbeat, true);
  assert.equal(closed.final_heartbeat, true);
  assert.equal(opened.duration_tracked_ms, 0);
  assert.equal(closed.duration_tracked_ms, 60_000);
  assert.equal(closed.client_track_timestamp - opened.client_track_timestamp, 60_000);
  assert.ok(opened.client_track_timestamp <= launched.client_track_timestamp);
  assert.ok(launched.client_track_timestamp <= closed.client_track_timestamp);
  assert.deepEqual(events.map((event) => event.properties.event_sequence_number), [1, 2, 3]);
  assert.ok(events.every((event) => event.properties.client_heartbeat_session_id === "test-heartbeat"));
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test("distinct game sessions do not share IDs and rebinding resets event sequence", () => {
  const first = science.buildSessionTriplet(game, 1_000);
  const second = science.buildSessionTriplet(anotherGame, 1_000);
  assert.notEqual(first[0].properties.game_session_id, second[0].properties.game_session_id);
  assert.deepEqual(second.map((event) => event.properties.event_sequence_number), [4, 5, 6]);
  science.bindSession("new-heartbeat", "new-launch", "e30=");
  const next = science.buildSessionTriplet(game, 1_000);
  assert.equal(next[0].properties.event_sequence_number, 1);
  assert.ok(next.every((event) => event.properties.launch_signature === "new-launch"));
});

test("variety duration is deterministic and absent fingerprint stays absent", () => {
  const first = science.buildVarietySession(game);
  const second = science.buildVarietySession(game);
  assert.equal(first[2].properties.duration_tracked_ms, 60_000);
  assert.equal(second[2].properties.duration_tracked_ms, 60_000);
  assert.equal(Object.hasOwn(first[1].properties, "executable_fingerprint"), false);
});

test("invalid direct session durations are rejected before generating malformed events", () => {
  for (const duration of [NaN, Infinity, -Infinity, -1, 0, "60000", Number.MAX_VALUE]) {
    assert.throws(() => science.buildSessionTriplet(game, duration), undefined, `game duration ${duration}`);
    assert.throws(() => science.buildStreamPair(game, duration), undefined, `stream duration ${duration}`);
  }
});

test("stream pairs expose consistent identity and actual durations for partial-delivery accounting", () => {
  const pair = science.buildStreamPair(game, 90_000);
  assert.deepEqual(pair.map((event) => event.type), ["video_stream_started", "video_stream_ended"]);
  const [start, end] = pair.map((event) => event.properties);
  for (const key of ["media_session_id", "rtc_connection_id", "stream_key", "game_id"]) assert.equal(start[key], end[key]);
  assert.equal(end.client_track_timestamp - start.client_track_timestamp, end.duration_ms);
  assert.equal(end.duration_ms, 90_000);
  assert.equal(end.duration, end.duration_ms);
  assert.equal(Object.hasOwn(start, "duration_ms"), false, "a start event alone cannot count as completed stream hours");
  assert.ok(end.num_frames > 0);
});

test("stream batch caps session count to games and preserves total completed duration", () => {
  const batch = science.buildStreamBatch([game, anotherGame], 1.25, 100);
  assert.equal(batch.sessions, 2);
  assert.equal(batch.events.length, 4);
  const ends = batch.events.filter((event) => event.type === "video_stream_ended");
  assert.equal(ends.reduce((sum, event) => sum + event.properties.duration_ms, 0), 1.25 * 3_600_000);
  assert.equal(new Set(ends.map((event) => event.properties.media_session_id)).size, 2);
  assert.equal(new Set(ends.map((event) => event.properties.game_id)).size, 2);
  for (let i = 0; i < batch.events.length; i += 2) {
    assert.equal(batch.events[i].properties.media_session_id, batch.events[i + 1].properties.media_session_id);
  }
});

test("invalid stream batch counts and non-finite or overflowing hours are rejected", () => {
  assert.throws(() => science.buildStreamBatch([], 1, 1));
  for (const count of [0, -1, 1.5, NaN, Infinity, "2"]) assert.throws(() => science.buildStreamBatch([game], 1, count));
  for (const hours of [0, -1, NaN, Infinity, -Infinity, "1", Number.MAX_VALUE]) {
    assert.throws(() => science.buildStreamBatch([game], hours, 1), undefined, `hours ${hours}`);
  }
});
