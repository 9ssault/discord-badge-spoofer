"use strict";

/**
 * Interactive terminal UI — banner, status strip, sectioned menu, prompts.
 */

const readline = require("readline");
const { CH, line, blank, plain, info, registerSecret } = require("./log");
const runtime = require("./runtime");
const { ORCA } = require("./banner");
const { LIMITS } = require("./config");
const vault = require("./vault");
const fmt = require("./format");
const checkpoint = require("./checkpoint");

let rl = null;
let activeSecretCancel = null;

function inputClosed(message = "Input closed.", code = "ERR_INPUT_CLOSED") {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = code;
  return error;
}

function getRl() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const current = rl;
    current.once("close", () => { if (rl === current) rl = null; });
  }
  return rl;
}

async function ask(question) {
  if (runtime.isAutomatic()) throw inputClosed("This operation needs an interactive terminal.");
  if (process.stdin.readableEnded || process.stdin.destroyed) throw inputClosed();
  runtime.signal().throwIfAborted();
  const current = getRl();
  return new Promise((resolve, reject) => {
    const signal = runtime.signal();
    const cleanup = () => {
      current.removeListener("close", onClose);
      current.removeListener("SIGINT", onCancel);
      signal.removeEventListener("abort", onCancel);
    };
    const onClose = () => { cleanup(); reject(inputClosed()); };
    const onCancel = () => { cleanup(); current.close(); reject(inputClosed("Cancelled.", "ABORT_ERR")); };
    current.once("close", onClose);
    current.once("SIGINT", onCancel);
    signal.addEventListener("abort", onCancel, { once: true });
    current.question(question, (answer) => { cleanup(); resolve(String(answer).trim()); });
  });
}

function closeRl() {
  if (activeSecretCancel) activeSecretCancel();
  if (rl) {
    try {
      rl.close();
    } catch (_) {}
    rl = null;
  }
}

/** Raw input never writes a credential to the terminal, including pasted text. */
async function askSecret(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Secret input requires a terminal. Supply credentials through the process environment for non-interactive use.");
  }
  if (runtime.isAutomatic()) throw new Error("Supply credentials through the process environment in automatic mode.");
  closeRl();
  runtime.signal().throwIfAborted();
  const input = process.stdin;
  const wasRaw = Boolean(input.isRaw);
  const wasPaused = input.isPaused();
  return new Promise((resolve, reject) => {
    let value = "";
    let finished = false;
    let escape = "";
    let pasting = false;
    let oversized = false;
    const signal = runtime.signal();
    const finish = (error) => {
      if (finished) return;
      finished = true;
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("error", onError);
      process.removeListener("SIGINT", onCancel);
      signal.removeEventListener("abort", onCancel);
      activeSecretCancel = null;
      try { input.setRawMode(wasRaw); } catch (_) {}
      if (wasPaused) input.pause();
      process.stdout.write("\x1b[?2004l\n");
      if (error) reject(error);
      else { registerSecret(value.trim()); resolve(value.trim()); }
      value = "";
    };
    const onEnd = () => finish(inputClosed());
    const onError = () => finish(inputClosed("Secret input failed."));
    const onCancel = () => finish(inputClosed("Cancelled.", "ABORT_ERR"));
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === "\x03" || char === "\x04") { onCancel(); return; }
        // Keep pasted newlines inside the masked prompt until Enter is pressed.
        // A multiline paste can arrive in several chunks; it must never leave
        // later chunks exposed to terminal echo after an early submission.
        if (escape) {
          escape += char;
          if (escape.length > 32 || (escape.length >= 3 && /[@-~]/.test(char))) {
            if (escape === "\x1b[200~") pasting = true;
            if (escape === "\x1b[201~") pasting = false;
            escape = "";
          }
          continue;
        }
        if (char === "\x1b") { escape = char; continue; }
        if (char === "\r" || char === "\n") {
          if (pasting) continue;
          finish(oversized ? new Error("Secret input exceeds the 8192-character limit.") : undefined); return;
        }
        if (char === "\x7f" || char === "\b") {
          if (value.length) { value = value.slice(0, -1); process.stdout.write("\b \b"); }
        } else if (char >= " ") {
          if (value.length >= 8192) { oversized = true; continue; }
          value += char; process.stdout.write("*");
        }
      }
    };
    activeSecretCancel = onCancel;
    input.once("end", onEnd);
    input.once("error", onError);
    input.on("data", onData);
    process.once("SIGINT", onCancel);
    signal.addEventListener("abort", onCancel, { once: true });
    try {
      input.setRawMode(true);
      process.stdout.write("\x1b[?2004h" + question);
      input.resume();
    } catch (_) { finish(new Error("Could not enable masked secret input.")); }
  });
}

function section(title) {
  plain(`${CH.dim}── ${CH.reset}${CH.white}${title}${CH.reset} ${CH.dim}${"—".repeat(Math.max(4, 36 - title.length))}${CH.reset}`);
}

function opt(key, name, desc) {
  plain(
    `  ${CH.orange}${String(key).padEnd(3)}${CH.reset}${CH.white}${name.padEnd(22)}${CH.reset}${CH.dim}${desc}${CH.reset}`
  );
}

function paint() {
  blank();
  for (const row of ORCA.art) plain(`${CH.orange}${row}${CH.reset}`);
  plain(`${CH.dim}  ${ORCA.tagline}${CH.reset}`);
  blank();

  if (runtime.isOffline()) {
    plain(`${CH.bold}${CH.cyan}OFFLINE PREVIEW${CH.reset} · demo catalog · no network or saved changes`);
  } else {
    plain(`${CH.bold}${CH.yellow}LIVE SESSION${CH.reset} · requests may be sent to Discord`);
  }
  blank();

  const s = vault.load();
  const auth = runtime.isOffline() ? `${CH.dim}not needed${CH.reset}` : s.token ? `${CH.green}in memory${CH.reset}` : `${CH.yellow}not supplied${CH.reset}`;
  const mint =
    s.analyticsToken && Date.now() - s.mintedAt < LIMITS.tokenTTL
      ? `${CH.green}fresh${CH.reset}`
      : `${CH.yellow}stale${CH.reset}`;
  const pace = s.settings.pace === "drip" ? `${CH.cyan}drip${CH.reset}` : `${CH.orange}standard${CH.reset}`;
  const cp = runtime.isOffline() ? null : checkpoint.load();

  plain(
    `  ${CH.dim}profile${CH.reset} ${CH.white}${s.activeProfile || "default"}${CH.reset}` +
      `  ${CH.dim}·${CH.reset}  ${CH.dim}auth${CH.reset} ${auth}` +
      `  ${CH.dim}·${CH.reset}  ${CH.dim}session${CH.reset} ${runtime.isOffline() ? "preview" : mint}` +
      `  ${CH.dim}·${CH.reset}  ${CH.dim}pace${CH.reset} ${pace}`
  );
  plain(
    `  ${CH.dim}local${CH.reset}  ${CH.white}${fmt.hours(s.totals.hours)}${CH.reset} play` +
      `  ${CH.dim}·${CH.reset}  ${CH.white}${fmt.hours(s.totals.streamHours || 0)}${CH.reset} stream` +
      `  ${CH.dim}·${CH.reset}  ${CH.white}${fmt.int(s.totals.varietyTitles || 0)}${CH.reset} variety` +
      `  ${CH.dim}·${CH.reset}  ${CH.white}${fmt.int(s.totals.runs)}${CH.reset} runs`
  );
  plain(`${CH.dim}Local accepted telemetry, badge credit unverified.${CH.reset}`);
  if (s.settings.dryRun && !runtime.isOffline()) plain(`  ${CH.yellow}DRY RUN ON — nothing will be sent${CH.reset}`);
  if (cp) {
    plain(
      `  ${CH.cyan}checkpoint${CH.reset} ${cp.plan?.mode || cp.mode || "?"} @ ${cp.index || 0}/${cp.total || "?"} ${CH.dim}(Tools → Resume)${CH.reset}`
    );
  }
  if (s.settings.catalogFilter && s.settings.catalogFilter !== "all") {
    plain(`  ${CH.dim}filter${CH.reset} ${s.settings.catalogFilter}`);
  }
  line();
}

function paintMenu() {
  paint();

  section(runtime.isOffline() ? "PREVIEW" : "TELEMETRY");
  opt("1", "playtime", "game-time hours across catalog");
  opt("2", "on titles", "search catalog · pick exact games");
  opt("3", "stream hours", "experimental · badge credit unverified");
  opt("4", "games played", "variety telemetry · ~1 min / title");
  opt("5", "all modes", "playtime + experimental stream + variety");
  opt("6", "next tier", "auto-fill gap to next ladder step");

  blank();
  section("PROGRESS");
  opt("7", "badge ladder", "local estimates · credit unverified");

  blank();
  section("SESSION");
  opt("8", "renew session", "re-mint analytics · swap cookie");
  opt("9", "fingerprint", "optional captured value · session only");

  blank();
  section("TOOLS");
  opt("10", "tools…", "catalog · settings · profiles · resume");
  opt("x", "exit", "quit");

  line();
  plain(`${CH.dim}  preview: node index.js --dry --auto --mode variety --titles 100${CH.reset}`);
  plain(`${CH.dim}  --help for options · --live explicitly enables network access${CH.reset}`);
  line();
}

async function showMenu(ctx) {
  const actions = require("./features");
  const choice = (await ask(`  ${CH.orange}❯${CH.reset} `)).toLowerCase();
  blank();
  switch (choice) {
    case "1":
      await actions.forgeBulk(ctx);
      break;
    case "2":
      await actions.forgeTitles(ctx);
      break;
    case "3":
      await actions.forgeStream(ctx);
      break;
    case "4":
      await actions.forgeVariety(ctx);
      break;
    case "5":
      await actions.forgeAll(ctx);
      break;
    case "6":
      await actions.forgeToNextTier(ctx);
      break;
    case "7":
      await actions.showLadder(ctx);
      break;
    case "8":
      await actions.renewSession(ctx);
      break;
    case "9":
      await actions.bindFingerprint(ctx);
      break;
    case "10":
    case "0": // keep 0 as alias
      await actions.toolsSubmenu(ctx);
      break;
    case "x":
    case "q":
    case "":
      return false;
    default:
      info(`unknown option ${CH.dim}${choice}${CH.reset} — use 1–10 or x`);
  }
  return true;
}

function parseNumber(raw, fallback, { integer = false, min = 0, max = 1000000 } = {}) {
  const value = String(raw).trim();
  if (value && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const n = value ? Number(value) : Number(fallback);
  if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n)) || n < min || n > max) return null;
  return n;
}

async function askNumber(promptText, fallback, options = {}) {
  const raw = await ask(promptText);
  return parseNumber(raw, fallback, options);
}

async function confirm(question) {
  const a = (await ask(`${question} ${CH.dim}[y/N]${CH.reset} `)).toLowerCase();
  return a === "y" || a === "yes";
}

function parseSelection(raw, count) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 100000) throw new RangeError("Catalog must contain at most 100,000 titles.");
  const text = String(raw).trim();
  if (!text) return Array.from({ length: Math.min(5, count) }, (_, i) => i);
  if (text.toLowerCase() === "a") return Array.from({ length: count }, (_, i) => i);
  if (text.length > 4096) throw new RangeError("Selection is too long.");
  const selected = new Set();
  for (const part of text.split(",")) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
    if (!match) throw new RangeError("Use title numbers or ranges, such as 1,3-5.");
    const first = Number(match[1]);
    const last = match[2] ? Number(match[2]) : first;
    if (![first, last].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= count)) {
      throw new RangeError(`Choose title numbers between 1 and ${count}.`);
    }
    for (let i = Math.min(first, last); i <= Math.max(first, last); i++) selected.add(i - 1);
  }
  return [...selected];
}

async function chooseGames(gamesList, preselected = null) {
  let pool = preselected || gamesList;
  if (!pool.length) {
    info("no titles matched");
    return [];
  }
  pool.slice(0, 30).forEach((g, i) => {
    plain(`  ${CH.dim}${String(i + 1).padStart(2)}${CH.reset} ${g.name} ${CH.dim}<${g.id}>${CH.reset}`);
  });
  if (pool.length > 30) info(`Showing first 30 of ${pool.length}; "a" selects the full matching catalog.`);
  const raw = await ask(`  ${CH.dim}pick (comma/ranges, enter=first 5, a=all):${CH.reset} `);
  try { return parseSelection(raw, pool.length).map((i) => pool[i]); }
  catch (error) { info(error.message); return []; }
}

module.exports = {
  ask,
  askSecret,
  closeRl,
  paint,
  paintMenu,
  showMenu,
  askNumber,
  parseNumber,
  parseSelection,
  confirm,
  chooseGames,
  section,
  opt,
};
