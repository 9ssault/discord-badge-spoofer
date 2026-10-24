"use strict";
const crypto = require("node:crypto");
const { CLIENT } = require("./config");
function localProps() {
  return {
    os: "Windows", browser: "Discord Client", release_channel: "stable",
    client_version: CLIENT.release, os_version: CLIENT.osRelease,
    os_arch: "x64", app_arch: "x64", system_locale: CLIENT.locale,
    has_client_mods: false, browser_user_agent: CLIENT.agent,
    browser_version: CLIENT.electron, os_sdk_version: CLIENT.osRelease.split(".").pop(),
    client_build_number: CLIENT.build, native_build_number: CLIENT.nativeBuild,
    client_event_source: null, client_app_state: "focused",
  };
}
async function buildSuperProps(heartbeatSession, launchSignature) {
  return Buffer.from(JSON.stringify({ ...localProps(),
    client_launch_id: crypto.randomUUID(), launch_signature: launchSignature,
    client_heartbeat_session_id: heartbeatSession,
  }), "utf8").toString("base64");
}
module.exports = { buildSuperProps, localProps };
