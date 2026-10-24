"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "badges-signin-bootstrap-"));
process.env.BADGES_DATA_DIR = temp;
const runtime = require("../src/runtime");
const vault = require("../src/vault");
const ui = require("../src/ui");
const session = require("../src/session");
const { bootstrap } = require("../index");
test.after(() => { vault.clearSecrets(); fs.rmSync(temp, { recursive: true, force: true }); });

test("direct sign-in retries rejected MFA only after fresh input, verifies identity and never persists credentials", async t => {
  runtime.configure({ offline: false, automatic: false });
  vault.resetForTests(); session.clear();
  const token = Buffer.from("123456789012345678").toString("base64") + ".bootstrap-fixture-secret";
  const answers = ["fixture@example.invalid", "  fixture-password  ", "123456", "234567"];
  let mfaCalls = 0;
  let question = 0;
  t.mock.method(ui, "askSecret", async (_label, options) => {
    if (question === 1) assert.equal(options.trim, false);
    return answers[question++];
  });
  const calls = [];
  t.mock.method(global, "fetch", async (input, options = {}) => {
    const url = String(input); calls.push(url);
    if (url === "https://discord.com/login") return new Response("<html></html>", {headers:{"set-cookie":"__dcfduid=fixture-cookie; Path=/; Secure; HttpOnly"}});
    if (url.endsWith("/auth/login")) {
      const data = JSON.parse(options.body);
      assert.equal(data.login, answers[0]); assert.equal(data.password, answers[1]);
      assert.equal(options.headers.authorization, undefined);
      return new Response(JSON.stringify({token:null,mfa:true,totp:true,ticket:"fixture-ticket",login_instance_id:"fixture-instance"}));
    }
    if (url.endsWith("/auth/mfa/totp")) {
      const data = JSON.parse(options.body);
      assert.equal(data.code, answers[2 + mfaCalls]); assert.equal(data.ticket, "fixture-ticket");
      assert.equal(data.login_instance_id, "fixture-instance");
      if (mfaCalls++ === 0) return new Response(JSON.stringify({code:60008,message:"Invalid two-factor code"}), {status:400});
      return new Response(JSON.stringify({token}));
    }
    if (url.includes("/users/@me")) {
      assert.equal(options.headers.authorization, token);
      return new Response(JSON.stringify({id:"123456789012345678",analytics_token:"fixture-analytics"}));
    }
    assert.equal(url, "https://cdn.discordapp.com/detectables/games.json");
    assert.equal(options.headers.authorization, undefined);
    return new Response(JSON.stringify([{id:"10",name:"Fixture game",executables:[{os:"win32",name:"fixture.exe"}]}]));
  });
  const ctx = await bootstrap({signin:true,auto:false});
  assert.equal(question,4); assert.equal(mfaCalls,2); assert.equal(ctx.games.length,1);
  assert.equal(vault.load().token,token);
  assert.match(vault.load().cookie,/__dcfduid=fixture-cookie/);
  assert.equal(vault.load().accountId,"123456789012345678");
  assert.equal(calls.length,6);
  assert.equal(calls.some(url=>url.includes("/science")),false);
  const saved = fs.readFileSync(path.join(temp,"vault.json"),"utf8");
  assert.doesNotMatch(saved,/fixture-password|fixture-cookie|fixture-ticket|fixture-instance|fixture-analytics|bootstrap-fixture-secret|example\.invalid/);
});
