"use strict";

/**
 * per-run identity: heartbeat session id, launch signature, super props,
 * plus the analytics token lifecycle.
 */

const crypto = require("crypto");
const vault = require("./vault");
const props = require("./props");
const science = require("./science");
const auth = require("./auth");

/** current base64 super-properties (set by begin/renew) */
let superProps = "";

async function begin() {
  const hb = crypto.randomUUID();
  const sig = crypto.randomUUID();
  const sp = await props.buildSuperProps(hb, sig);
  superProps = sp;
  science.bindSession(hb, sig, sp);
  return { hb, sig, superProps: sp };
}

async function renew() {
  const s = vault.load();
  const sp = await props.buildSuperProps(crypto.randomUUID(), crypto.randomUUID());
  superProps = sp;
  s.analyticsToken = await auth.mintAnalyticsToken(sp);
  s.mintedAt = Date.now();
  vault.save();
  await begin();
  return s.analyticsToken;
}

function getSuperProps() {
  return superProps;
}

module.exports = {
  begin,
  renew,
  getSuperProps,
  // legacy accessor used by forge.js
  get superProps() {
    return superProps;
  },
};
