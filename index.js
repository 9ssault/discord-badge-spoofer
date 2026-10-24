#!/usr/bin/env node
"use strict";

const runtime = require("./src/runtime");
const vault = require("./src/vault");
const session = require("./src/session");
const games = require("./src/games");
const features = require("./src/features");
const ui = require("./src/ui");
const log = require("./src/log");
const { PATHS, LIMITS, PRESETS } = require("./src/config");
const VERSION = "4.0.0";

function parseArgs(argv) {
  const args = { auto: false, live: false, dry: false, demo: false, help: false,
    version: false, mode: "variety", hours: null, titles: null, target: null,
    pace: null, preset: null, profile: "default", filter: null };
  const values = new Map([
    ["--mode", "mode"], ["-m", "mode"], ["--hours", "hours"], ["-H", "hours"],
    ["--titles", "titles"], ["-t", "titles"], ["--target", "target"],
    ["--pace", "pace"], ["--preset", "preset"], ["--profile", "profile"], ["--filter", "filter"],
  ]);
  const flags = { "--auto": "auto", "-a": "auto", "--live": "live", "--dry": "dry",
    "--dry-run": "dry", "--demo": "demo", "--help": "help", "-h": "help",
    "--version": "version", "-v": "version" };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flags[flag]) args[flags[flag]] = true;
    else if (values.has(flag)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error("Missing value for " + flag);
      args[values.get(flag)] = value;
    } else throw new Error("Unknown option: " + flag + ". Use --help.");
  }
  if (args.live && (args.dry || args.demo)) throw new Error("--live cannot be combined with --dry or --demo.");
  if (!["variety", "playtime", "stream", "all"].includes(args.mode)) throw new Error("Mode must be variety, playtime, stream, or all.");
  if (args.pace && !["standard", "aggressive", "drip"].includes(args.pace)) throw new Error("Pace must be standard or drip.");
  if (args.preset && !Object.hasOwn(PRESETS, args.preset)) throw new Error("Unknown preset.");
  if (args.filter && !["all", "verified", "steam", "no-launcher"].includes(args.filter)) throw new Error("Unknown catalog filter.");
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(args.profile)) throw new Error("Profile must be 1–48 letters, digits, underscores, or hyphens.");
  for (const key of ["hours", "titles", "target"]) {
    if (args[key] === null) continue;
    args[key] = Number(args[key]);
    const max = key === "titles" ? LIMITS.maxTitles : LIMITS.maxHours;
    if (!Number.isFinite(args[key]) || args[key] <= 0 || args[key] > max ||
      (key === "titles" && !Number.isInteger(args[key]))) {
      throw new Error(key + " must be a positive " + (key === "titles" ? "integer" : "number") + " at most " + max + ".");
    }
  }
  if (args.demo) { args.auto = true; if (args.titles === null) args.titles = 100; }
  if (args.target !== null && args.mode === "all") throw new Error("--target requires a single mode.");
  if (args.preset && args.target !== null) throw new Error("Use either --preset or --target.");
  if (args.target !== null && args.mode === "variety" && !Number.isInteger(args.target)) throw new Error("A variety target must be an integer.");
  return args;
}

function printHelp() {
  console.log(`
  9ssault / Ultimate Edition  ${VERSION}
  Local activity experiments. Actual badge credit is unverified.

  node index.js                         offline interactive preview
  node index.js --demo                  offline 100-game preview
  node index.js --dry --auto --mode variety --titles 100
  node index.js --live                  interactive live mode
  node index.js --live --auto --mode variety --titles 100
  node index.js --live --auto --mode playtime --hours 1 --titles 5
  node index.js --live --auto --mode stream --hours 5

  --mode variety|playtime|stream|all    streaming is experimental
  --hours N                            hours/title, or total stream hours
  --titles N                           maximum unique titles selected
  --target N                           local accepted-total target; not a badge reading
  --preset max-variety|quick-play|dump-play|dump-stream
  --profile NAME                       isolated metadata; credentials never saved
  --filter all|verified|steam|no-launcher
  --pace standard|drip                 drip pauses 15 minutes between batches
  --dry / --demo                       no network, credential access, or state writes
  --live                               explicitly enable authenticated requests
  --help / --version

  Node.js 22+; no dependencies to install.
  Live automation accepts DISCORD_TOKEN and CF_CLEARANCE_COOKIE from the
  process environment only. Interactive live input is masked.
  Files named .env are never read or written. BADGES_DATA_DIR selects the
  metadata directory. Dry-run games are labeled fictional demo records.
`);
}

function seedFromEnv() {
  if (runtime.isOffline()) return;
  const s = vault.load();
  for (const [name, field] of [["DISCORD_TOKEN", "token"], ["CF_CLEARANCE_COOKIE", "cookie"]]) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      s[field] = value.trim();
      log.registerSecret(s[field]);
    }
  }
}

async function bootstrap(args) {
  const s = vault.load();
  s.settings.dryRun = runtime.isOffline();
  if (args.pace) s.settings.pace = args.pace === "aggressive" ? "standard" : args.pace;
  if (args.filter) s.settings.catalogFilter = args.filter;
  if (runtime.isOffline()) {
    log.info("OFFLINE PREVIEW · fictional demo catalog · nothing sent or saved");
    await session.begin();
    return { games: await games.loadGames() };
  }
  log.warn("Unofficial activity submission can violate Discord's terms and risk the account.");
  log.info("Credentials remain in memory. Badge credit cannot be confirmed by this tool.");
  seedFromEnv();
  for (const [field, label, variable] of [["token", "Discord account token", "DISCORD_TOKEN"],
    ["cookie", "Discord cookie header", "CF_CLEARANCE_COOKIE"]]) {
    if (!s[field]) {
      if (args.auto) throw new Error(variable + " is missing. Supply it privately through the process environment.");
      s[field] = await ui.askSecret(label + ": ");
      if (!s[field]) throw new Error(label + " is required.");
      log.registerSecret(s[field]);
    }
  }
  log.info("Loading Discord's game catalog…");
  const catalog = await games.loadGames();
  if (!catalog.length) throw new Error("The live catalog could not be loaded. No activity was submitted.");
  await session.begin();
  await session.renew();
  log.info("Session ready · " + catalog.length + " catalog entries");
  vault.save();
  return { games: catalog };
}

async function runAuto(args, ctx) {
  const s = vault.load();
  const preset = args.preset ? PRESETS[args.preset] : {};
  const mode = preset.mode || args.mode;
  let hours = preset.hours ?? args.hours ?? s.settings.hoursDefault;
  let count = preset.titles ?? args.titles ?? (mode === "variety" ? 100 : 20);
  if (args.target !== null) {
    const current = mode === "variety" ? s.totals.varietyTitles : mode === "stream" ? s.totals.streamHours : s.totals.hours;
    const remaining = Math.max(0, args.target - current);
    log.info("Target uses local accepted telemetry totals; Discord badge progress is unknown.");
    if (!remaining) { log.info("Local target already met; no request made."); return; }
    if (mode === "variety") count = remaining;
    else if (mode === "stream") hours = remaining;
    else hours = remaining; // divide by actual selected count below
  }
  const catalog = features.filteredCatalog(ctx.games);
  if (!catalog.length) throw new Error("No catalog entries match the filter.");
  const selected = features.pickRotating(catalog, count);
  if (selected.length < count) log.info("Using " + selected.length + " available titles (requested " + count + ").");
  if (mode === "playtime" && args.target !== null) hours /= selected.length;
  if (mode === "stream" || mode === "all") {
    const sessions = Math.min(catalog.length, 100, Math.max(1, Math.ceil(hours / 10)));
    const result = await features.executeStreamForge(features.pickRotating(catalog, sessions), hours, sessions);
    if (result.failed || result.cancelled || result.checkpointError || result.persistenceError) return;
  }
  if (mode === "variety" || mode === "all") {
    const result = await features.executeForge(selected, 1 / 60, "variety");
    if (result.failed || result.cancelled || result.checkpointError || result.persistenceError) return;
  }
  if (mode === "playtime" || mode === "all") await features.executeForge(selected, hours, "playtime");
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return; }
  if (args.version) { console.log(VERSION); return; }
  runtime.configure({ offline: !args.live, automatic: args.auto });
  try {
    if (!args.auto && !process.stdin.isTTY) throw new Error("Interactive mode needs a terminal. Try node index.js --demo.");
    vault.switchProfile(args.profile);
    session.clear();
    const ctx = await bootstrap(args);
    if (args.auto) await runAuto(args, ctx);
    else {
      while (!runtime.signal().aborted) {
        ui.paintMenu();
        if (!await ui.showMenu(ctx)) break;
      }
    }
    if (runtime.signal().aborted) process.exitCode = 130;
  } finally {
    vault.clearSecrets();
    ui.closeRl();
  }
}

if (require.main === module) {
  process.on("SIGINT", () => { runtime.cancel(); ui.closeRl(); process.exitCode = 130; });
  process.on("SIGTERM", () => { runtime.cancel(); ui.closeRl(); process.exitCode = 130; });
  main().catch(err => {
    const interrupted = runtime.signal().aborted || err?.name === "AbortError";
    log.fail(interrupted ? "Stopped. Accepted telemetry may already have reached Discord." : err.message || "Run failed.");
    process.exitCode = interrupted ? 130 : 1;
  }).finally(() => { vault.clearSecrets(); ui.closeRl(); });
}
module.exports = { parseArgs, main, runAuto, bootstrap, seedFromEnv, VERSION };
