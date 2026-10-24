"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const ui = require("../src/ui");
const log = require("../src/log");
const runtime = require("../src/runtime");

test("title selection accepts explicit ranges, deduplicates and bounds work", () => {
  assert.deepEqual(ui.parseSelection("1,3-5,4,8-7", 10), [0, 2, 3, 4, 6, 7]);
  assert.deepEqual(ui.parseSelection("", 2), [0, 1]);
  assert.deepEqual(ui.parseSelection("a", 3), [0, 1, 2]);
  for (const value of ["1-999999999999", "0", "-1", "1junk", "1.5", "1--3", "1,", "1e2", "99999999999999999999999"]) {
    assert.throws(() => ui.parseSelection(value, 10), RangeError);
  }
  assert.throws(() => ui.parseSelection("a", 100001), RangeError);
  assert.throws(() => ui.parseSelection("1,".repeat(3000), 10), RangeError);
});

test("number input validates defaults, finiteness, integers and upper bounds", () => {
  assert.equal(ui.parseNumber("2.5", 1), 2.5);
  assert.equal(ui.parseNumber("", 3, { min: 1, max: 5 }), 3);
  assert.equal(ui.parseNumber("", 30, { max: 5 }), null);
  for (const value of ["Infinity", "NaN", "1e99", "0x10", "123garbage", "1000001"]) assert.equal(ui.parseNumber(value, 1), null);
  assert.equal(ui.parseNumber("2.5", 1, { integer: true }), null);
  assert.equal(ui.parseNumber("-1", 1), null);
});

test("log redacts nested credentials, errors and registered secret values", () => {
  log.registerSecret("fixture-session-credential");
  assert.deepEqual(log.redact({ token: "private", meta: { authorization: "private", count: 3 }, cookie: "private" }), {
    token: "[REDACTED]", meta: { authorization: "[REDACTED]", count: 3 }, cookie: "[REDACTED]",
  });
  assert.equal(log.redact(new Error("request failed: fixture-session-credential")), "request failed: [REDACTED]");
  assert.equal(log.redact("token=secret-value cookie=other-secret"), "token=[REDACTED] cookie=[REDACTED]");
});

test("redirected logs have no ANSI controls and clear never erases scrollback", () => {
  const result = spawnSync(process.execPath, ["-e", "const l=require('./src/log'); l.info('\\x1b[31mhello\\x1b[0m'); l.clear();"], {
    cwd: path.join(__dirname, ".."), encoding: "utf8", env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /hello/);
  assert.doesNotMatch(result.stdout, /\x1b/);
});

test("NO_COLOR disables colors on a TTY", () => {
  const result = spawnSync(process.execPath, ["-e", "Object.defineProperty(process.stdout,'isTTY',{value:true}); process.stdout.write(require('./src/log').CH.red || 'plain');"], {
    cwd: path.join(__dirname, ".."), encoding: "utf8", env: { ...process.env, NO_COLOR: "" },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "plain");
});

test("automatic pause resolves immediately and prompts fail without hanging", async () => {
  runtime.configure({ automatic: true, offline: true });
  assert.equal(await log.pause(), "");
  await assert.rejects(ui.ask("unexpected prompt"), /interactive terminal/);
  runtime.configure({ offline: true });
});

function fakeTerminal() {
  ui.closeRl();
  const inputDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
  const outputDescriptor = Object.getOwnPropertyDescriptor(process, "stdout");
  const input = new EventEmitter();
  let paused = true;
  input.isTTY = true;
  input.isRaw = false;
  input.isPaused = () => paused;
  input.pause = () => { paused = true; };
  input.resume = () => { paused = false; };
  input.setRawMode = (raw) => { input.isRaw = raw; };
  let output = "";
  const sink = { isTTY: true, write: (value) => { output += value; } };
  Object.defineProperty(process, "stdin", { configurable: true, value: input });
  Object.defineProperty(process, "stdout", { configurable: true, value: sink });
  return {
    input, output: () => output,
    restore() {
      ui.closeRl();
      Object.defineProperty(process, "stdin", inputDescriptor);
      Object.defineProperty(process, "stdout", outputDescriptor);
    },
  };
}

test("secret paste is masked and terminal state is restored on submit", async () => {
  runtime.configure({ offline: true });
  const terminal = fakeTerminal();
  try {
    const pending = ui.askSecret("Credential: ");
    assert.equal(terminal.input.isRaw, true);
    terminal.input.emit("data", Buffer.from("\x1b[200~private-paste\x1b[201~\r"));
    assert.equal(await pending, "private-paste");
    assert.doesNotMatch(terminal.output(), /private-paste/);
    assert.match(terminal.output(), /\*{13}/);
    assert.equal(terminal.input.isRaw, false);
    assert.equal(terminal.input.isPaused(), true);
    assert.equal(terminal.input.listenerCount("data"), 0);
  } finally { terminal.restore(); }
});

test("secret input restores terminal on cancellation and EOF", async () => {
  for (const event of ["cancel", "end", "abort"]) {
    runtime.configure({ offline: true });
    const terminal = fakeTerminal();
    try {
      const pending = ui.askSecret("Credential: ");
      const rejected = assert.rejects(pending, { name: "AbortError" });
      if (event === "cancel") terminal.input.emit("data", Buffer.from("abc\x03"));
      else if (event === "abort") runtime.cancel();
      else terminal.input.emit("end");
      await rejected;
      assert.equal(terminal.input.isRaw, false);
      assert.equal(terminal.input.isPaused(), true);
      assert.equal(terminal.input.listenerCount("data"), 0);
    } finally { terminal.restore(); }
  }
  runtime.configure({ offline: true });
});

test("multiline bracketed paste stays masked across chunks until Enter", async () => {
  runtime.configure({ offline: true });
  const terminal = fakeTerminal();
  try {
    const pending = ui.askSecret("Credential: ");
    terminal.input.emit("data", Buffer.from("\x1b[200~first-part\r\n"));
    assert.equal(terminal.input.isRaw, true);
    terminal.input.emit("data", Buffer.from("second-part\x1b[201~"));
    assert.equal(terminal.input.isRaw, true);
    terminal.input.emit("data", Buffer.from("\r"));
    assert.equal(await pending, "first-partsecond-part");
    assert.doesNotMatch(terminal.output(), /first-part|second-part/);
    assert.equal(terminal.input.isRaw, false);
  } finally { terminal.restore(); }
});

test("secret prompts refuse non-terminal input without printing a prompt", async () => {
  const terminal = fakeTerminal();
  try {
    terminal.input.isTTY = false;
    await assert.rejects(ui.askSecret("Credential: "), /process environment/);
    assert.equal(terminal.output(), "");
  } finally { terminal.restore(); }
});
