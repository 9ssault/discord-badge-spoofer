"use strict";

const runtime = require("./runtime");
const colorEnabled = Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env) && process.env.TERM !== "dumb";
const palette = {
  reset: "\x1b[0m", dim: "\x1b[90m", red: "\x1b[91m", green: "\x1b[92m",
  yellow: "\x1b[93m", white: "\x1b[97m", orange: "\x1b[38;5;208m",
  cyan: "\x1b[96m", bold: "\x1b[1m", inverse: "\x1b[7m",
};
const CH = Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, colorEnabled ? value : ""]));
const BULLET = "\u25aa";
const secrets = new Set();
const secretKey = /token|cookie|authorization|password|secret|fingerprint|credential/i;

function registerSecret(value) {
  if (typeof value === "string" && value.trim()) secrets.add(value);
}
function redactText(value) {
  let result = String(value);
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) result = result.split(secret).join("[REDACTED]");
  return result
    .replace(/\b(?:mfa\.[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,})\b/g, "[REDACTED]")
    .replace(/\b(authorization|(?:analytics[_-]?)?token|cookie|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi, "$1=[REDACTED]");
}
function redact(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Error) return redactText(value.message);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? "[REDACTED]" : redact(item, seen)]));
}
function render(value) {
  const safe = redact(value);
  const result = typeof safe === "string" ? safe : JSON.stringify(safe) ?? String(safe);
  // Preserve our SGR colors only when supported; strip other terminal controls.
  return result.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, (sequence) => colorEnabled && /^\x1b\[[0-9;]*m$/.test(sequence) ? sequence : "")
    .replace(/\x1b(?!\[[0-9;]*m)/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, "");
}
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return CH.dim + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + CH.reset;
}
function out(value) { console.log(render(value)); }
function write(value) { process.stdout.write(render(value)); }
function tagged(tag, tagColor, msgColor, msg) {
  out("  " + stamp() + " " + CH.dim + "[" + tagColor + tag + CH.dim + "]" + CH.reset + " " + msgColor + render(msg) + CH.reset);
}
function pass(msg) { tagged(" ok ", CH.green, CH.green, msg); }
function fail(msg) { tagged(" !! ", CH.red, CH.red, msg); }
function warn(msg) { tagged(" ~! ", CH.yellow, CH.yellow, msg); }
function info(msg) { tagged(" -> ", CH.cyan, CH.white, msg); }
function dim(msg) { out("  " + CH.dim + render(msg) + CH.reset); }
function plain(msg) { out("  " + render(msg)); }
function blank() { out(""); }
function heading(text) { out("  " + CH.bold + CH.white + render(text) + CH.reset); }
function keyValue(key, value, keyColor = CH.orange) {
  plain(keyColor + key + CH.reset + " " + CH.dim + "\u2192" + CH.reset + " " + CH.white + (secretKey.test(String(key)) ? "[REDACTED]" : render(value)) + CH.reset);
}
function line(char = "\u2500", width = 62) { out("  " + CH.dim + String(char).repeat(Math.max(0, Math.min(120, Number(width) || 0))) + CH.reset); }
function clear() { /* Preserve terminal scrollback, including errors and run summaries. */ }
function pause(msg = "press enter to go back") {
  if (runtime.isAutomatic() || !process.stdin.isTTY) return Promise.resolve("");
  return require("./ui").ask("  " + CH.dim + msg + CH.reset);
}
module.exports = { CH, BULLET, out, write, pass, fail, warn, info, dim, plain, blank, heading, keyValue, line, clear, stamp, pause, redact, registerSecret };
