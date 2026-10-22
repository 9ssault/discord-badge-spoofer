"use strict";

/**
 * science event construction.
 * - playtime / games-played: launch_game + running_game_heartbeat
 * - streaming: video_stream_started + video_stream_ended
 *   (aligned with Discord client trackVideoStartStats / trackVideoEndStats)
 */

const crypto = require("crypto");
const { CLIENT } = require("./config");
const vault = require("./vault");
const auth = require("./auth");

let seq = 0;
let heartbeatSession = "";
let launchSignature = "";
let superPropsB64 = "";

function bindSession(hb, sig, props) {
  heartbeatSession = hb;
  launchSignature = sig;
  superPropsB64 = props;
  seq = 0;
}

function nextSeq() {
  return ++seq;
}

function buildLaunchEvent(game) {
  const now = Date.now();
  const state = vault.load();
  const props = {
    client_track_timestamp: now,
    client_heartbeat_session_id: heartbeatSession,
    event_sequence_number: nextSeq(),
    game: game.name,
    game_id: game.id,
    verified: true,
    elevated: false,
    is_launcher: false,
    game_platform: "desktop",
    detection_method: "verified_game",
    is_overlay_enabled: false,
    is_overlay_game_enabled: true,
    is_overlay_game_source: "OOP_DEFAULT_DATABASE",
    fullscreen_type: "UNKNOWN",
    hardware_display_count: 1,
    overlay_method: "Disabled",
    activity_status_enabled: true,
    activity_status_shared_guilds: [],
    current_user_status: "online",
    game_detection_enabled: true,
    executable_path: game.exe,
    voice_channel_id: null,
    voice_channel_type: null,
    voice_channel_bitrate: null,
    voice_channel_guild_id: null,
    hidden_by_distributor: false,
    game_metadata: null,
    executable_fingerprint: state.fingerprint || undefined,
    client_performance_cpu: null,
    client_performance_memory: null,
    cpu_core_count: null,
    accessibility_features: 0,
    rendered_locale: CLIENT.locale,
    launch_signature: launchSignature,
    client_rtc_state: null,
    client_app_state: "focused",
    client_send_timestamp: now,
  };
  if (!state.fingerprint) delete props.executable_fingerprint;
  return { type: "launch_game", properties: props };
}

function buildHeartbeatEvent(game, durationMs, sessionId, initial, final, ts = null) {
  const timestamp = ts === null ? Date.now() : ts;
  return {
    type: "running_game_heartbeat",
    properties: {
      client_track_timestamp: timestamp,
      client_heartbeat_session_id: heartbeatSession,
      event_sequence_number: nextSeq(),
      game_id: game.id,
      game_name: game.name,
      game_metadata: null,
      game_executable: game.exe,
      game_detection_enabled: true,
      initial_heartbeat: initial,
      final_heartbeat: final,
      game_session_id: sessionId,
      duration_tracked_ms: durationMs,
      rtc_connection_id: null,
      media_session_id: null,
      launch_signature: launchSignature,
      client_app_state: "focused",
      client_send_timestamp: timestamp,
    },
  };
}

function buildSessionTriplet(game, durationMs) {
  const sid = crypto.randomUUID();
  const now = Date.now();
  let start = now - durationMs;
  if (start < 0) start = now;
  return [
    buildHeartbeatEvent(game, 0, sid, true, false, start),
    buildLaunchEvent(game),
    buildHeartbeatEvent(game, durationMs, sid, false, true, now),
  ];
}

/**
 * Build VIDEO_STREAM_STARTED + VIDEO_STREAM_ENDED for one session.
 * Properties mirror Discord desktop client trackVideoStartStats / trackVideoEndStats.
 * durationMs is the full claimed stream length (can be multi-hour).
 */
function buildStreamPair(game, durationMs) {
  const now = Date.now();
  let start = now - durationMs;
  if (start < 0) start = now;

  const state = vault.load();
  const userId = auth.userIdFromToken(state.token) || "0";
  const mediaSessionId = crypto.randomUUID();
  const rtcConnectionId = crypto.randomUUID();
  // real client stream keys: guild:{guildId}:{channelId}:{userId} or call:{...}
  const channelId = String(BigInt("0x" + crypto.randomBytes(8).toString("hex")));
  const streamKey = `call:${channelId}:${userId}`;

  // client only emits VIDEO_STREAM_ENDED when outbound num_frames > 0
  const fps = 30;
  const durationSec = Math.max(1, Math.floor(durationMs / 1000));
  const numFrames = durationSec * fps;
  const maxViewers = 1 + Math.floor(Math.random() * 3); // 1–3 “viewers”
  const avgBitrate = 2500 + Math.floor(Math.random() * 2000);

  const common = {
    client_heartbeat_session_id: heartbeatSession,
    media_session_id: mediaSessionId,
    rtc_connection_id: rtcConnectionId,
    parent_media_session_id: null,
    stream_key: streamKey,
    stream_type: "go_live",
    stream_source_type: "application",
    context: "STREAM",
    application_id: game.id,
    application_name: game.name,
    game_id: game.id,
    game_name: game.name,
    game_executable: game.exe || null,
    sender_user_id: userId,
    participant_type: "streamer",
    voice_participant_type: "streamer",
    channel_type: 2, // GUILD_VOICE
    connection_type: "udp",
    client_app_state: "focused",
    launch_signature: launchSignature,
    max_viewers: maxViewers,
    num_viewers: maxViewers,
  };

  const started = {
    type: "video_stream_started",
    properties: {
      ...common,
      event_sequence_number: nextSeq(),
      client_track_timestamp: start,
      client_send_timestamp: start,
      duration_go_live_modal: Math.floor(600 + Math.random() * 2500),
      effective_connection_speed: "4g",
      service_provider: null,
    },
  };

  const ended = {
    type: "video_stream_ended",
    properties: {
      ...common,
      event_sequence_number: nextSeq(),
      client_track_timestamp: now,
      client_send_timestamp: now,
      duration: durationMs,
      duration_ms: durationMs,
      reason: "user_requested",
      paused: false,
      // outbound video stats (client gates on num_frames > 0)
      num_frames: numFrames,
      avg_fps: fps,
      avg_bitrate: avgBitrate,
      avg_resolution: 1080,
      hardware_enabled: false,
      app_hardware_acceleration_enabled: false,
      quality_preset: "auto",
    },
  };

  return [started, ended];
}

/**
 * Split total stream hours into N large sessions and build all events.
 * Prefer fewer, longer sessions (more realistic than 1h × N).
 */
function buildStreamBatch(games, totalHours, sessions) {
  const n = Math.max(1, Math.min(sessions, games.length));
  const per = totalHours / n;
  const events = [];
  for (let i = 0; i < n; i++) {
    const wobble = 1 + (Math.random() * 0.06 - 0.03);
    const ms = Math.max(60_000, Math.floor(per * wobble * 3600 * 1000));
    const game = games[i % games.length];
    for (const ev of buildStreamPair(game, ms)) events.push(ev);
  }
  return { events, sessions: n, hoursEach: per };
}

/** Short playtime session (~1 min) for games-played / variety badge. */
function buildVarietySession(game) {
  const ms = 60_000 + Math.floor(Math.random() * 30_000);
  return buildSessionTriplet(game, ms);
}

module.exports = {
  bindSession,
  nextSeq,
  buildLaunchEvent,
  buildHeartbeatEvent,
  buildSessionTriplet,
  buildStreamPair,
  buildStreamBatch,
  buildVarietySession,
};
