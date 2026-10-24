"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "badges-features-test-"));
process.env.BADGES_DATA_DIR = temp;
const runtime = require("../src/runtime");
const vault = require("../src/vault");
const session = require("../src/session");
const forge = require("../src/forge");
const features = require("../src/features");
const originals = {run:forge.runForges, record:forge.recordRun, rotate:vault.rotateMemory,
  log:console.log, fetch:global.fetch};
let output;
test.beforeEach(async () => {
  runtime.configure({offline:false, automatic:true});
  vault.resetForTests();
  const s = vault.load();
  Object.assign(s, {token:"fixture-token", cookie:"fixture-cookie", analyticsToken:"fixture-analytics", mintedAt:Date.now()});
  await session.begin();
  output = [];
  console.log = text => output.push(String(text));
  global.fetch = () => { throw new Error("Unexpected network access"); };
  forge.recordRun = () => {};
  vault.rotateMemory = () => {};
});
test.afterEach(() => {
  forge.runForges = originals.run;
  forge.recordRun = originals.record;
  vault.rotateMemory = originals.rotate;
  console.log = originals.log;
  global.fetch = originals.fetch;
  vault.clearSecrets();
  process.exitCode = 0;
});
test.after(() => fs.rmSync(temp, {recursive:true, force:true}));
const game = {id:"123", name:"Fixture", exe:"fixture.exe"};
const accepted = () => ({ok:1, failed:0, acceptedHours:1/60, acceptedIds:["123"], status:204});
test("imported dryRun metadata cannot change the process execution mode", async () => {
  vault.load().settings.dryRun = true;
  forge.runForges = async (_games, _builder, settings) => {
    assert.equal(settings.dryRun, false);
    return accepted();
  };
  await features.executeForge([game], 1/60, "variety");
  assert.match(output.join("\n"), /Accepted this run: 1/);
  assert.doesNotMatch(output.join("\n"), /No requests/);
});
test("storage failure after acceptance still reports the delivered result", async () => {
  forge.runForges = async () => accepted();
  forge.recordRun = () => { throw new Error("disk full"); };
  const result = await features.executeForge([game], 1/60, "variety");
  assert.equal(result.persistenceError, true);
  assert.equal(process.exitCode, 1);
  assert.match(output.join("\n"), /bookkeeping could not be saved/);
  assert.match(output.join("\n"), /Accepted this run: 1/);
  assert.match(output.join("\n"), /UNVERIFIED/);
});
test("fictional demo titles are refused in live mode before any transport", async () => {
  forge.runForges = async () => { throw new Error("Transport should not run"); };
  await assert.rejects(features.executeForge([{...game,demo:true}],1/60,"variety"), /Demo titles cannot/);
});
