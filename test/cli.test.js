"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "badges-cli-test-"));
const guard = path.join(temp, "offline-guard.cjs");
fs.writeFileSync(guard, `
  global.fetch = () => { throw new Error('OFFLINE NETWORK VIOLATION'); };
  const fs = require('node:fs');
  const read = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    if (/(?:vault\\.json|checkpoint\\.json|journal\\.jsonl|science_state\\.json|[\\\\/]\\.env)$/.test(String(file))) {
      throw new Error('OFFLINE STATE READ VIOLATION');
    }
    return read.call(this, file, ...args);
  };
  for (const name of ['writeFileSync','appendFileSync','mkdirSync','renameSync','unlinkSync']) {
    fs[name] = () => { throw new Error('OFFLINE WRITE VIOLATION'); };
  }
`);
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

function run(args, guarded = true) {
  return spawnSync(process.execPath, [...(guarded ? ["--require", guard] : []), "index.js", ...args], {
    cwd: root, encoding: "utf8", timeout: 15000,
    env: { ...process.env, NO_COLOR: "1", BADGES_DATA_DIR: path.join(temp, "state"),
      DISCORD_TOKEN: "DECOY_SECRET_DO_NOT_READ", CF_CLEARANCE_COOKIE: "DECOY_COOKIE_DO_NOT_READ" },
  });
}
for (const mode of ["variety", "playtime", "stream", "all"]) {
  test("CLI offline " + mode + " never networks, reads state, writes, or exposes credentials", () => {
    const result = run(["--dry", "--auto", "--mode", mode, "--titles", "3", "--hours", "1"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Preview complete/);
    assert.doesNotMatch(result.stdout + result.stderr, /VIOLATION|DECOY|\x1b\[/);
    assert.equal(fs.existsSync(path.join(temp, "state")), false);
  });
}
test("demo, help and version work without setup or a terminal", () => {
  for (const args of [["--demo"], ["--help"], ["--version"]]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});
test("invalid flags and conflicting execution modes fail before any side effect", () => {
  for (const args of [["--nonesuch"], ["--live", "--dry"], ["--titles", "Infinity"],
    ["--titles", "1.5"], ["--hours", "-1"], ["--mode", "bad"],
    ["--profile", "../../private"], ["--titles"], ["--mode", "all", "--target", "10"]]) {
    const result = run(args);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /VIOLATION|DECOY/);
  }
});
test("nonterminal interactive startup fails promptly", () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /needs a terminal/);
});

test("full live command with mocked endpoints counts accepted titles and persists no credentials", () => {
  const fixture = path.join(temp, "live-fixture.cjs");
  const state = path.join(temp, "mocked-live-state");
  const modulePath = JSON.stringify(path.join(root, "index.js"));
  fs.writeFileSync(fixture, `
    const assert = require('node:assert/strict');
    process.env.BADGES_DATA_DIR = ${JSON.stringify(state)};
    process.env.DISCORD_TOKEN = Buffer.from('123456789012345678').toString('base64') + '.fixture-secret';
    process.env.CF_CLEARANCE_COOKIE = 'cf_clearance=fixture-cookie';
    let posts = 0;
    global.fetch = async (input, options = {}) => {
      const url = String(input);
      if (url === 'https://cdn.discordapp.com/detectables/games.json') {
        assert.equal(options.headers.authorization, undefined);
        return new Response(JSON.stringify(Array.from({length: 3}, (_, i) => ({id: String(10+i), name: 'Fixture ' + i,
          executables: [{os:'win32',name:'fixture.exe'}]}))));
      }
      if (url.includes('/users/@me')) return new Response(JSON.stringify({id:'123456789012345678',analytics_token:'fixture-analytics-secret'}));
      assert.equal(url, 'https://discord.com/api/v9/science');
      const payload = JSON.parse(options.body);
      assert.equal(payload.events.length, 9);
      posts++;
      return new Response(null, {status:204});
    };
    require(${modulePath}).main(['node','index.js','--live','--auto','--mode','variety','--titles','3'])
      .then(() => { assert.equal(posts,1); require(${JSON.stringify(path.join(root, "src/vault.js"))}).clearSecrets(); })
      .catch(error => { console.error(error); process.exitCode = 1; });
  `);
  const result = spawnSync(process.execPath, [fixture], {cwd:root, encoding:"utf8", timeout:15000,
    env:{...process.env, NO_COLOR:"1"}});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const saved = fs.readFileSync(path.join(state, "vault.json"), "utf8");
  assert.doesNotMatch(saved + result.stdout + result.stderr, /fixture-secret|fixture-cookie|fixture-analytics-secret/);
  const data = JSON.parse(saved);
  assert.equal(data.totals.varietyTitles, 3);
  assert.equal(data.totals.hours, 3 / 60);
  assert.match(result.stdout, /UNVERIFIED/);
});
