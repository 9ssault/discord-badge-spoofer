"use strict";

const runtime = require("./runtime");
const { LIMITS } = require("./config");

const ALLOWED_HOSTS = new Set(["discord.com", "cdn.discordapp.com"]);
const MAX_RETRIES = 6;

function checkUrl(input) {
  let url;
  try { url = new URL(input); } catch (_) { throw new Error("Invalid request URL."); }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) ||
      url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Requests are restricted to HTTPS Discord and its official CDN.");
  }
  return url;
}

function finite(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
}

async function retryAfterMs(response, now = Date.now()) {
  const delays = [];
  const header = response.headers.get("retry-after");
  if (header != null && header.trim()) {
    const trimmed = header.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) delays.push(Number(trimmed) * 1000);
    else {
      const date = Date.parse(trimmed);
      if (Number.isFinite(date)) delays.push(Math.max(0, date - now));
    }
  }
  try {
    const body = await response.clone().json();
    if (body && typeof body.retry_after === "number" && Number.isFinite(body.retry_after) && body.retry_after >= 0) {
      delays.push(body.retry_after * 1000);
    }
  } catch (_) { /* A rate-limit response is not always JSON. */ }
  return delays.length ? Math.ceil(Math.max(...delays)) : null;
}

async function attempt(url, options, timeoutMs) {
  runtime.assertOnline();
  const controller = new AbortController();
  const signals = [...new Set([runtime.signal(), options.signal].filter(Boolean))];
  const listeners = signals.map((signal) => {
    const listener = () => controller.abort(signal.reason);
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
    return [signal, listener];
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(url, { ...options, redirect: "error", signal: controller.signal });
    // Buffer while the timeout is active, so a stalled response body also aborts.
    const body = [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer();
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (_) {
    const aborted = signals.find((signal) => signal.aborted);
    if (aborted) throw aborted.reason || new DOMException("Request cancelled", "AbortError");
    const error = new Error(timedOut ? "Request timed out; delivery may be uncertain." : "Network request failed; delivery may be uncertain.");
    error.code = timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR";
    throw error;
  } finally {
    clearTimeout(timer);
    for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
  }
}

async function request(input, options = {}) {
  runtime.assertOnline();
  const url = checkUrl(input);
  const { timeoutMs = LIMITS.requestTimeoutMs || 15000, maxRetries = 0,
    retryBaseMs = LIMITS.retryBaseMs || 800, maxRetryWaitMs = 5 * 60 * 1000, ...fetchOptions } = options;
  const retries = Math.floor(finite(maxRetries, 0, 0, MAX_RETRIES));
  const timeout = finite(timeoutMs, 15000, 1, 120000);
  const method = String(fetchOptions.method || "GET").toUpperCase();
  for (let index = 0; ; index++) {
    const response = await attempt(url, fetchOptions, timeout);
    const retryable = response.status === 429 || ((method === "GET" || method === "HEAD") && response.status >= 500);
    if (!retryable || index >= retries) return response;
    let delay = response.status === 429 ? await retryAfterMs(response) : null;
    if (delay == null) delay = finite(retryBaseMs, 800, 1) * 2 ** index;
    // Never shorten a server-specified delay. Return the response when it is too long.
    if (!Number.isFinite(delay) || delay > finite(maxRetryWaitMs, 300000)) return response;
    if (fetchOptions.signal && fetchOptions.signal.aborted) throw fetchOptions.signal.reason;
    await runtime.sleep(delay);
  }
}

module.exports = { request, retryAfterMs, checkUrl };
