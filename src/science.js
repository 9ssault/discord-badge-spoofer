"use strict";

/**
 * science event construction.
 * - playtime / games-played: launch_game + running_game_heartbeat
 * - streaming badge: video_stream_started + video_stream_ended (host)
 * - dual-token: viewer posts stream_watch_* counterparts
 */

const crypto = require("crypto");
const { CLIENT } = require("./config");
const vault = require("./vault");

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
 * Host-side streaming events.
 * Shared media/rtc ids so a dual-token viewer can reference the same session.
 */
function buildStreamPair(game, durationMs, shared = null) {
  const now = Date.now();
  let start = now - durationMs;
  if (start < 0) start = now;

  const mediaSessionId = (shared && shared.mediaSessionId) || crypto.randomUUID();
  const rtcConnectionId = (shared && shared.rtcConnectionId) || crypto.randomUUID();
  const streamKey =
    (shared && shared.streamKey) ||
    `guild:${shared && shared.guildId ? shared.guildId : "0"}:${shared && shared.channelId ? shared.channelId : crypto.randomUUID().replace(/-/g, "").slice(0, 16)}:${game.id}`;

  const state = vault.load();
  const guildId = (shared && shared.guildId) || state.streamGuildId || null;
  const channelId = (shared && shared.channelId) || state.streamChannelId || null;
  const numViewers = shared && shared.hasViewer ? 1 : Math.max(1, Math.floor(Math.random() * 3) + 1);

  const common = {
    client_heartbeat_session_id: heartbeatSession,
    media_session_id: mediaSessionId,
    rtc_connection_id: rtcConnectionId,
    stream_key: streamKey,
    stream_type: "go_live",
    application_id: game.id,
    application_name: game.name,
    game_id: game.id,
    game_name: game.name,
    game_executable: game.exe,
    max_viewers: 50,
    num_viewers: numViewers,
    voice_participant_type: "streamer",
    channel_type: 2,
    connection_type: "udp",
    client_app_state: "focused",
    launch_signature: launchSignature,
    guild_id: guildId,
    channel_id: channelId,
  };

  const started = {
    type: "video_stream_started",
    properties: {
      ...common,
      event_sequence_number: nextSeq(),
      client_track_timestamp: start,
      client_send_timestamp: start,
      duration_go_live_modal: Math.floor(800 + Math.random() * 2000),
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
      avg_fps: 30,
      avg_bitrate: 2500 + Math.floor(Math.random() * 1500),
      avg_resolution: 1080,
    },
  };

  return {
    events: [started, ended],
    shared: { mediaSessionId, rtcConnectionId, streamKey, guildId, channelId, hasViewer: !!(shared && shared.hasViewer) },
  };
}

/**
 * Viewer-side counterparts for dual-token mode.
 * Posts as the alt account so Discord sees a watcher on the same stream_key.
 */
function buildViewerStreamPair(game, durationMs, shared) {
  const now = Date.now();
  let start = now - durationMs;
  if (start < 0) start = now;

  const mediaSessionId = shared.mediaSessionId || crypto.randomUUID();
  const rtcConnectionId = shared.rtcConnectionId || crypto.randomUUID();
  const streamKey = shared.streamKey || `call:${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}:${game.id}`;

  const common = {
    client_heartbeat_session_id: heartbeatSession,
    media_session_id: mediaSessionId,
    rtc_connection_id: rtcConnectionId,
    stream_key: streamKey,
    stream_type: "go_live",
    application_id: game.id,
    application_name: game.name,
    game_id: game.id,
    game_name: game.name,
    voice_participant_type: "viewer",
    channel_type: 2,
    connection_type: "udp",
    client_app_state: "focused",
    launch_signature: launchSignature,
    guild_id: shared.guildId || null,
    channel_id: shared.channelId || null,
  };

  const started = {
    type: "stream_watch_started",
    properties: {
      ...common,
      event_sequence_number: nextSeq(),
      client_track_timestamp: start,
      client_send_timestamp: start,
      num_viewers: 1,
    },
  };

  const ended = {
    type: "stream_watch_ended",
    properties: {
      ...common,
      event_sequence_number: nextSeq(),
      client_track_timestamp: now,
      client_send_timestamp: now,
      duration: durationMs,
      duration_ms: durationMs,
      reason: "user_requested",
      num_viewers: 1,
    },
  };

  // also emit video_stream_watch variants some clients use
  const vStarted = {
    type: "video_stream_watch_started",
    properties: { ...started.properties, event_sequence_number: nextSeq() },
  };
  const vEnded = {
    type: "video_stream_watch_ended",
    properties: { ...ended.properties, event_sequence_number: nextSeq() },
  };

  return [started, ended, vStarted, vEnded];
}

/** Short playtime session (~1 min) used for games-played / variety badge. */
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
  buildViewerStreamPair,
  buildVarietySession,
};
