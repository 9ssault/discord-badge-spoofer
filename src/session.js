"use strict";
const crypto = require("node:crypto");
const vault = require("./vault");
const props = require("./props");
const science = require("./science");
const auth = require("./auth");
const runtime = require("./runtime");
let superProps = "";
async function begin() {
  const hb = crypto.randomUUID(), sig = crypto.randomUUID();
  superProps = await props.buildSuperProps(hb, sig);
  science.bindSession(hb, sig, superProps);
  return { hb, sig, superProps };
}
async function renew() {
  runtime.assertOnline();
  const s = vault.load();
  if (!s.token) throw new Error("Credentials are missing for this profile.");
  if (!superProps) await begin();
  s.analyticsToken = await auth.mintAnalyticsToken(superProps);
  require("./log").registerSecret(s.analyticsToken);
  s.mintedAt = Date.now();
  return s.analyticsToken;
}
function getSuperProps() { return superProps; }
function clear() { superProps = ""; }
module.exports = { begin, renew, clear, getSuperProps, get superProps() { return superProps; } };
