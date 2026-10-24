"use strict";

// Process-wide execution policy. Dry runs never read credentials, write state,
// or make network calls. Cancellation is shared by all requests and waits.
let offline = false;
let automatic = false;
let controller = new AbortController();

function configure(options = {}) {
  offline = Boolean(options.offline);
  automatic = Boolean(options.automatic);
  controller = new AbortController();
}
function isOffline() { return offline; }
function isAutomatic() { return automatic; }
function signal() { return controller.signal; }
function cancel() { controller.abort(); }
function assertOnline() {
  if (offline) throw new Error("Network access is disabled for this offline preview.");
  controller.signal.throwIfAborted();
}
async function sleep(ms) {
  signal().throwIfAborted();
  if (offline || ms <= 0) return;
  await new Promise((resolve, reject) => {
    const activeSignal = signal();
    const onAbort = () => { clearTimeout(timer); reject(activeSignal.reason); };
    const timer = setTimeout(() => { activeSignal.removeEventListener("abort", onAbort); resolve(); }, ms);
    activeSignal.addEventListener("abort", onAbort, { once: true });
  });
}

module.exports = { configure, isOffline, isAutomatic, signal, cancel, assertOnline, sleep };
