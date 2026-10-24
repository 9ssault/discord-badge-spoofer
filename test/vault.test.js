"use strict";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "badges-vault-test-"));
const dataRoot = path.join(tempRoot, "data");
process.env.BADGES_DATA_DIR = dataRoot;
const { PATHS, DEFAULT_SETTINGS } = require("../src/config");
const runtime = require("../src/runtime");
const vault = require("../src/vault");
const envstore = require("../src/envstore");

// Fail before creating fixtures if isolation is accidentally removed.
assert.equal(path.resolve(PATHS.vault), path.join(dataRoot, "vault.json"));
const secretKeys = ["token", "cookie", "analyticsToken", "fingerprint"];
function fillSecrets(state, suffix = "one") {
  for (const key of secretKeys) state[key] = `FAKE_SECRET_${key}_${suffix}`;
  state.mintedAt = Date.now();
}
function assertEmptySecrets(state) {
  for (const key of secretKeys) assert.equal(state[key], "", key);
  assert.equal(state.mintedAt, 0);
}
function assertSanitized(value) {
  const text = JSON.stringify(value);
  assert.ok(!text.includes("FAKE_SECRET"));
  for (const key of [...secretKeys, "mintedAt"]) assert.equal(Object.hasOwn(value, key), false, key);
}
function clearFixtures() {
  const resolved = path.resolve(dataRoot);
  assert.equal(path.dirname(resolved), path.resolve(tempRoot));
  fs.rmSync(resolved, { recursive: true, force: true });
}
beforeEach(() => {
  runtime.configure({ offline: false });
  vault.resetForTests();
  clearFixtures();
});
after(() => {
  runtime.configure({ offline: false });
  vault.resetForTests();
  assert.equal(path.dirname(path.resolve(tempRoot)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(tempRoot).startsWith("badges-vault-test-"));
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("saving preserves in-memory auth but writes only sanitized metadata", () => {
  const state = vault.load();
  fillSecrets(state);
  state.settings.unexpected = "FAKE_SECRET_settings";
  state.extra = "FAKE_SECRET_top";
  state.lastRun = { mode: "variety", ok: 2, token: "FAKE_SECRET_nested", acceptedIds: ["12", "13"] };
  state.totals.varietyTitles = 2;
  state.acceptedGameIds = ["12", "13", "12", "FAKE_SECRET_id"];
  vault.save();
  assert.equal(state.token, "FAKE_SECRET_token_one");
  assert.equal(vault.tokenFresh(), true);
  const disk = JSON.parse(fs.readFileSync(PATHS.vault, "utf8"));
  assertSanitized(disk);
  assert.equal(disk.totals.varietyTitles, 2);
  assert.deepEqual(disk.acceptedGameIds, ["12", "13"]);
  assert.equal(Object.hasOwn(disk, "extra"), false);
  assert.equal(fs.existsSync(PATHS.envFile), false);
});

test("persisted and legacy credentials are never restored", () => {
  fs.mkdirSync(dataRoot, { recursive: true });
  const old = { token: "FAKE_SECRET_old", cookie: "FAKE_SECRET_old", analyticsToken: "FAKE_SECRET_old",
    fingerprint: "FAKE_SECRET_old", mintedAt: Date.now(), totals: { hours: 3 } };
  fs.writeFileSync(PATHS.vault, JSON.stringify(old));
  fs.writeFileSync(PATHS.legacyVault, JSON.stringify(old));
  const state = vault.load();
  assertEmptySecrets(state);
  assert.equal(state.totals.hours, 3);
  vault.save();
  assertSanitized(JSON.parse(fs.readFileSync(PATHS.vault, "utf8")));
  fs.unlinkSync(PATHS.vault);
  vault.resetForTests();
  assertEmptySecrets(vault.load());
  assert.equal(vault.load().totals.hours, 0, "legacy file must not be migrated");
});

test("exports are always sanitized and imports cannot replace current auth or profile", () => {
  const state = vault.load();
  vault.bindAccount("111111");
  fillSecrets(state);
  assertSanitized(vault.exportVault({ redact: false }));
  assertSanitized(vault.exportVault({ redact: true }));
  vault.importVault({ token: "FAKE_SECRET_import", cookie: "FAKE_SECRET_import",
    analyticsToken: "FAKE_SECRET_import", fingerprint: "FAKE_SECRET_import",
    accountId: "111111", activeProfile: "other", settings: { batchSize: 4 }, totals: { hours: 7 } }, { mergeCreds: true });
  assert.equal(state.token, "FAKE_SECRET_token_one");
  assert.equal(state.activeProfile, "default");
  assert.equal(state.settings.batchSize, 4);
  assert.equal(state.totals.hours, 7);
  assertSanitized(JSON.parse(fs.readFileSync(PATHS.vault, "utf8")));
});

test("profile switching clears both the previous reference and the new profile auth", () => {
  const original = vault.load();
  fillSecrets(original);
  original.totals.hours = 8;
  original.acceptedGameIds = ["123"];
  vault.saveProfile("default");
  assert.equal(original.token, "FAKE_SECRET_token_one");
  const second = vault.switchProfile("friend");
  assertEmptySecrets(original);
  assertEmptySecrets(second);
  assert.equal(second.totals.hours, 0);
  fillSecrets(second, "two");
  vault.saveProfile("gift");
  assertEmptySecrets(second);
  const restored = vault.switchProfile("default");
  assertEmptySecrets(restored);
  assert.equal(restored.totals.hours, 8);
  assert.deepEqual(restored.acceptedGameIds, ["123"]);
  for (const name of ["default", "friend", "gift"]) {
    const file = vault.profilePath(name);
    if (fs.existsSync(file)) assertSanitized(JSON.parse(fs.readFileSync(file, "utf8")));
  }
  fillSecrets(restored);
  assertEmptySecrets(vault.switchProfile("default"));
});

test("unsafe settings and metadata are bounded or replaced by valid defaults", () => {
  const settings = vault.sanitizeSettings({ batchSize: 500, batchPauseMs: Infinity,
    maxRetries: 100, hoursDefault: -2, dripPauseMs: NaN, dripHoursPerDay: 100,
    pace: "FAKE_SECRET_bad", catalogFilter: "invalid", dryRun: "false", token: "FAKE_SECRET_bad" });
  assert.equal(settings.batchSize, 50);
  assert.equal(vault.sanitizeSettings({ batchSize: -5 }).batchSize, 1);
  assert.equal(settings.maxRetries, 4);
  assert.equal(settings.batchPauseMs, DEFAULT_SETTINGS.batchPauseMs);
  assert.equal(settings.dripPauseMs, DEFAULT_SETTINGS.dripPauseMs);
  assert.equal(settings.hoursDefault, DEFAULT_SETTINGS.hoursDefault);
  assert.equal(settings.dripHoursPerDay, 24);
  assert.equal(settings.pace, DEFAULT_SETTINGS.pace);
  assert.equal(settings.dryRun, DEFAULT_SETTINGS.dryRun);
  assert.ok(!JSON.stringify(settings).includes("FAKE_SECRET"));
  vault.importVault({ accountId: "111111", totals: { hours: NaN, titles: -9 }, recentIds: ["123", "123", "invalid"] });
  assert.equal(vault.load().totals.hours, 0);
  assert.equal(vault.load().totals.titles, 0);
  assert.deepEqual(vault.load().recentIds, ["123"]);
});

test("offline vault and environment operations never touch files or online auth", (t) => {
  fillSecrets(vault.load());
  runtime.configure({ offline: true });
  for (const method of ["readFileSync", "writeFileSync", "existsSync", "readdirSync", "mkdirSync"]) {
    t.mock.method(fs, method, () => { throw new Error(`unexpected offline file access: ${method}`); });
  }
  assertEmptySecrets(vault.load());
  vault.load().totals.hours = 20;
  vault.save();
  vault.saveProfile("preview");
  vault.switchProfile("other");
  vault.importVault({ token: "FAKE_SECRET_import", settings: { batchSize: 2 } });
  vault.rotateMemory(["123"]);
  assert.deepEqual(vault.listProfiles(), ["default", "other"]);
  assertSanitized(vault.exportVault({ redact: false }));
  assert.equal(vault.tokenFresh(), false);
  assert.equal(envstore.loadQuiet().size, 0);
  assert.deepEqual(envstore.loadAndPrint(), {});
  assert.equal(envstore.sync({ token: "FAKE_SECRET_sync" }), false);
  for (const method of ["readFileSync", "writeFileSync", "existsSync", "readdirSync", "mkdirSync"]) {
    assert.equal(fs[method].mock.calls.length, 0, method);
  }
});

test("environment helper only reads exact process keys and never reveals values", (t) => {
  const keys = ["DISCORD_TOKEN", "CF_CLEARANCE_COOKIE", "TOKEN", "COOKIE"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => { for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  } });
  delete process.env.DISCORD_TOKEN;
  delete process.env.CF_CLEARANCE_COOKIE;
  process.env.TOKEN = "FAKE_SECRET_alias";
  process.env.COOKIE = "FAKE_SECRET_alias";
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(PATHS.envFile, "DISCORD_TOKEN=FAKE_SECRET_disk\n");
  assert.equal(envstore.loadQuiet().size, 0);
  process.env.DISCORD_TOKEN = "  FAKE_SECRET_process_token  ";
  process.env.CF_CLEARANCE_COOKIE = "FAKE_SECRET_process_cookie";
  assert.deepEqual([...envstore.loadQuiet()], [
    ["DISCORD_TOKEN", "FAKE_SECRET_process_token"], ["CF_CLEARANCE_COOKIE", "FAKE_SECRET_process_cookie"],
  ]);
  const messages = [];
  t.mock.method(console, "log", (...args) => messages.push(args.join(" ")));
  const summary = envstore.loadAndPrint();
  assert.ok(!JSON.stringify(summary).includes("FAKE_SECRET"));
  assert.ok(!messages.join(" ").includes("FAKE_SECRET"));
  envstore.sync({ token: "FAKE_SECRET_new" });
  assert.equal(fs.readFileSync(PATHS.envFile, "utf8"), "DISCORD_TOKEN=FAKE_SECRET_disk\n");
});

test("clearing secrets invalidates cached auth without deleting metadata", () => {
  const state = vault.load();
  state.totals.hours = 4;
  fillSecrets(state);
  assert.equal(vault.tokenFresh(), true);
  vault.clearSecrets();
  assertEmptySecrets(state);
  assert.equal(state.totals.hours, 4);
  assert.equal(vault.tokenFresh(), false);
});

test("account binding survives reload and renewal cannot reuse another account's history", () => {
  const state = vault.load();
  fillSecrets(state);
  vault.bindAccount("111111");
  assert.equal(state.accountId, "111111");
  state.totals.hours = 9;
  state.acceptedGameIds = ["123"];
  vault.save();
  vault.clearSecrets();
  fillSecrets(state, "renewed");
  assert.equal(vault.bindAccount("111111"), state);
  assert.equal(state.token, "FAKE_SECRET_token_renewed");
  const before = fs.readFileSync(PATHS.vault, "utf8");
  assert.throws(() => vault.bindAccount("222222"), /different --profile/);
  assertEmptySecrets(state);
  assert.equal(state.accountId, "111111");
  assert.equal(state.totals.hours, 9);
  assert.deepEqual(state.acceptedGameIds, ["123"]);
  assert.equal(fs.readFileSync(PATHS.vault, "utf8"), before);
  vault.resetForTests();
  assert.equal(vault.load().accountId, "111111");
  assertEmptySecrets(vault.load());
  assert.equal(vault.switchProfile("fresh").accountId, "");
  vault.bindAccount("222222");
  assert.equal(vault.load().accountId, "222222");
  assert.equal(vault.load().totals.hours, 0);
});

test("unbound historical activity cannot be assigned to the next authenticating account", () => {
  const state = vault.load();
  state.totals.hours = 4;
  fillSecrets(state);
  vault.save();
  const before = fs.readFileSync(PATHS.vault, "utf8");
  assert.throws(() => vault.bindAccount("111111"), /fresh --profile/);
  assertEmptySecrets(state);
  assert.equal(state.accountId, "");
  assert.equal(state.totals.hours, 4);
  assert.equal(fs.readFileSync(PATHS.vault, "utf8"), before);
  vault.switchProfile("ids-only");
  vault.load().acceptedGameIds = ["123"];
  assert.throws(() => vault.bindAccount("111111"), /fresh --profile/);
});

test("imports cannot cross account bindings or merge unbound activity into bound totals", () => {
  const state = vault.load();
  vault.bindAccount("111111");
  state.totals.hours = 6;
  vault.save();
  fillSecrets(state);
  const before = fs.readFileSync(PATHS.vault, "utf8");
  assert.throws(() => vault.importVault({ accountId: "222222", settings: { batchSize: 2 }, totals: { hours: 30 } }), /different --profile/);
  assert.throws(() => vault.importVault({ totals: { hours: 30 } }), /same account/);
  assert.throws(() => vault.importVault({ acceptedGameIds: ["999"] }), /same account/);
  assert.equal(state.totals.hours, 6);
  assert.equal(state.accountId, "111111");
  assert.equal(fs.readFileSync(PATHS.vault, "utf8"), before);
  vault.importVault({ settings: { batchSize: 2 } });
  assert.equal(state.settings.batchSize, 2);
  assert.equal(state.totals.hours, 6);
  vault.importVault({ accountId: "111111", totals: { hours: 8 }, acceptedGameIds: ["123"] });
  assert.equal(state.totals.hours, 8);
  assert.equal(state.token, "FAKE_SECRET_token_one");
});

test("fresh profiles can import bound metadata but must authenticate as that account", () => {
  const state = vault.load();
  fillSecrets(state);
  vault.importVault({ accountId: "222222", totals: { hours: 7 }, acceptedGameIds: ["123"] });
  assert.equal(state.accountId, "222222");
  assertEmptySecrets(state);
  assert.equal(vault.exportVault().accountId, "222222");
  assert.throws(() => vault.bindAccount("111111"), /different --profile/);
  assert.equal(vault.bindAccount("222222").totals.hours, 7);
  assert.equal(JSON.parse(fs.readFileSync(PATHS.vault, "utf8")).accountId, "222222");
  vault.switchProfile("legacy");
  vault.load().totals.hours = 1;
  assert.throws(() => vault.importVault({ accountId: "222222", totals: { hours: 7 } }), /fresh --profile/);
});

test("account identities reject non-digit values and binding is disabled offline", () => {
  for (const value of ["bad", "", "111.222", "../123", 123, null, "1".repeat(31)]) {
    fillSecrets(vault.load());
    assert.throws(() => vault.bindAccount(value), /invalid account identity/);
    assertEmptySecrets(vault.load());
  }
  assert.throws(() => vault.importVault({ accountId: "FAKE_SECRET" }), /Invalid imported/);
  runtime.configure({ offline: true });
  assert.throws(() => vault.bindAccount("111111"), /offline/);
});
