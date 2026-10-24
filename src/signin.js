"use strict";

const runtime = require("./runtime");
const http = require("./http");
const log = require("./log");
const { CLIENT } = require("./config");

const LOGIN_PAGE = "https://discord.com/login";
const LOGIN_API = "https://discord.com/api/v9/auth/login";
const TOTP_API = "https://discord.com/api/v9/auth/mfa/totp";
const SESSION_API = "https://discord.com/api/v9/science";
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/;
const MESSAGES = {
  AUTH_OFFLINE: "Sign-in is unavailable in offline mode.",
  AUTH_CANCELLED: "Sign-in was cancelled.",
  AUTH_BUSY: "A sign-in request is already pending.",
  AUTH_INPUT: "Enter a nonempty login and password without control characters.",
  AUTH_INVALID_CREDENTIALS: "The login or password was rejected.",
  AUTH_INVALID_CODE: "The authenticator code was rejected; enter a six-digit code.",
  AUTH_MFA_REQUIRED: "Start sign-in before entering an authenticator code.",
  AUTH_MFA_UNSUPPORTED: "This account requires an unsupported sign-in method.",
  AUTH_RATE_LIMIT: "Discord limited sign-in attempts. Wait before trying again.",
  AUTH_CHALLENGE: "Discord requires additional verification. Direct sign-in stopped; a browser login does not connect this program.",
  AUTH_RESPONSE: "Discord returned an unexpected sign-in response.",
  AUTH_NETWORK: "The sign-in request could not be completed. Its delivery may be uncertain.",
};

class SignInError extends Error {
  constructor(code, response, data) {
    super(MESSAGES[code]);
    this.code = code;
    if (response && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) this.status = response.status;
    if (data && Number.isSafeInteger(data.code) && data.code >= 0) this.discordCode = data.code;
  }
}

function online() {
  try { runtime.assertOnline(); }
  catch (_) { throw new SignInError(runtime.isOffline() ? "AUTH_OFFLINE" : "AUTH_CANCELLED"); }
}

function nonempty(value) {
  return typeof value === "string" && Boolean(value.trim()) && !CONTROLS.test(value);
}

// Only cookies returned by this session's HTTPS requests enter this jar. There is
// no browser, vault, filesystem, or ambient Cookie header input.
function receiveCookies(jar, response, url) {
  if (!response.headers || typeof response.headers.getSetCookie !== "function") throw new SignInError("AUTH_RESPONSE");
  for (const raw of response.headers.getSetCookie()) {
    if (typeof raw !== "string" || CONTROLS.test(raw)) throw new SignInError("AUTH_RESPONSE");
    log.registerSecret(raw);
    const [pair, ...parts] = raw.split(";");
    const equals = pair.indexOf("=");
    if (equals < 1) throw new SignInError("AUTH_RESPONSE");
    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(unquoted)) {
      throw new SignInError("AUTH_RESPONSE");
    }
    log.registerSecret(value);
    const attrs = new Map(parts.map((part) => {
      const split = part.indexOf("=");
      return split < 0 ? [part.trim().toLowerCase(), ""] : [part.slice(0, split).trim().toLowerCase(), part.slice(split + 1).trim()];
    }));
    const domain = attrs.get("domain");
    if (domain != null && domain.toLowerCase().replace(/^\./, "") !== "discord.com") continue;
    const pathname = new URL(url).pathname;
    const defaultPath = pathname.slice(0, pathname.lastIndexOf("/")) || "/";
    const path = (attrs.get("path") || "").startsWith("/") ? attrs.get("path") : defaultPath;
    if (name.startsWith("__Secure-") && !attrs.has("secure")) continue;
    if (name.startsWith("__Host-") && (!attrs.has("secure") || domain != null || path !== "/")) continue;
    let expires = Date.parse(attrs.get("expires"));
    if (/^-?\d+$/.test(attrs.get("max-age") || "")) expires = Date.now() + Number(attrs.get("max-age")) * 1000;
    const key = `${path}\n${name}`;
    if (Number.isFinite(expires) && expires <= Date.now()) jar.delete(key);
    else jar.set(key, { name, value, path, expires });
  }
}

function cookieHeader(jar, url) {
  const pathname = new URL(url).pathname;
  const cookies = [];
  for (const [key, cookie] of jar) {
    if (Number.isFinite(cookie.expires) && cookie.expires <= Date.now()) jar.delete(key);
    else if (pathname === cookie.path || pathname.startsWith(cookie.path.endsWith("/") ? cookie.path : cookie.path + "/")) cookies.push(cookie);
  }
  return cookies.sort((a, b) => b.path.length - a.path.length).map(({ name, value }) => `${name}=${value}`).join("; ");
}

function createSignInSession({ superProperties = "" } = {}) {
  online();
  if (typeof superProperties !== "string" || CONTROLS.test(superProperties) || !nonempty(CLIENT.agent) || !nonempty(CLIENT.locale)) throw new SignInError("AUTH_INPUT");
  const jar = new Map();
  let ticket = "", loginInstanceId = "", unsupportedMfa = false, active = null;
  let generation = 0;

  function clear() {
    generation++;
    if (active) active.controller.abort();
    active = null;
    ticket = "";
    loginInstanceId = "";
    unsupportedMfa = false;
    jar.clear();
  }

  function check(operation) {
    online();
    if (operation.generation !== generation) throw new SignInError("AUTH_CANCELLED");
  }

  async function send(url, body, operation) {
    check(operation);
    const headers = {
      accept: "application/json", "accept-language": CLIENT.locale,
      "user-agent": CLIENT.agent, "x-discord-locale": CLIENT.locale,
      origin: "https://discord.com", referer: LOGIN_PAGE,
    };
    if (superProperties) headers["x-super-properties"] = superProperties;
    const cookie = cookieHeader(jar, url);
    if (cookie) { headers.cookie = cookie; log.registerSecret(cookie); }
    if (body) headers["content-type"] = "application/json";
    const response = await http.request(url, {
      method: body ? "POST" : "GET", headers, maxRetries: 0,
      signal: operation.controller.signal, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    check(operation);
    if (response.status === 403) throw new SignInError("AUTH_CHALLENGE", response);
    if (response.status === 429) throw new SignInError("AUTH_RATE_LIMIT", response);
    receiveCookies(jar, response, url);
    return response;
  }

  async function result(response, operation, isTotp) {
    let data;
    try { data = await response.json(); }
    catch (_) { throw new SignInError("AUTH_RESPONSE", response); }
    check(operation);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new SignInError("AUTH_RESPONSE", response);
    for (const field of ["token", "ticket", "login_instance_id"]) log.registerSecret(data[field]);
    if (Object.keys(data).some((key) => /^captcha(?:_|$)/i.test(key)) || (Array.isArray(data.required_actions) && data.required_actions.length)) throw new SignInError("AUTH_CHALLENGE", response, data);
    if (!response.ok) throw new SignInError([400, 401].includes(response.status) ? (isTotp ? "AUTH_INVALID_CODE" : "AUTH_INVALID_CREDENTIALS") : "AUTH_RESPONSE", response, data);
    if (nonempty(data.token)) {
      const authenticated = { status: "authenticated", token: data.token, cookie: cookieHeader(jar, SESSION_API) };
      log.registerSecret(authenticated.cookie);
      clear();
      return authenticated;
    }
    if (data.token != null && data.token !== "") throw new SignInError("AUTH_RESPONSE", response, data);
    if (!isTotp && data.mfa === true && nonempty(data.ticket)) {
      if (data.login_instance_id != null && !nonempty(data.login_instance_id)) throw new SignInError("AUTH_RESPONSE", response, data);
      const methods = { totp: data.totp === true, sms: data.sms === true, backup: data.backup === true };
      if (data.totp !== true) {
        clear();
        unsupportedMfa = true;
        return { status: "mfa_required", ...methods };
      }
      ticket = data.ticket;
      loginInstanceId = data.login_instance_id || "";
      return { status: "mfa_required", ...methods };
    }
    throw new SignInError("AUTH_RESPONSE", response, data);
  }

  function failure(error, operation, preserveTicket = false) {
    const safe = error instanceof SignInError ? error : new SignInError(runtime.isOffline() ? "AUTH_OFFLINE" : runtime.signal().aborted ? "AUTH_CANCELLED" : "AUTH_NETWORK");
    if (operation && operation.generation !== generation) return new SignInError("AUTH_CANCELLED");
    if (!preserveTicket || safe.code !== "AUTH_INVALID_CODE") clear();
    return safe;
  }

  async function start(login, password) {
    let operation;
    try {
      online();
      if (active) throw new SignInError("AUTH_BUSY");
      clear();
      if (!nonempty(login) || !nonempty(password)) throw new SignInError("AUTH_INPUT");
      log.registerSecret(login);
      log.registerSecret(password);
      operation = { generation, controller: new AbortController() };
      active = operation;
      const bootstrap = await send(LOGIN_PAGE, null, operation);
      if (!bootstrap.ok) throw new SignInError("AUTH_RESPONSE", bootstrap);
      const response = await send(LOGIN_API, { login, password }, operation);
      password = "";
      login = "";
      return await result(response, operation, false);
    } catch (error) {
      if (error instanceof SignInError && error.code === "AUTH_BUSY") throw error;
      throw failure(error, operation);
    } finally {
      password = "";
      login = "";
      if (active === operation) active = null;
    }
  }

  async function completeTotp(code) {
    let operation;
    try {
      online();
      if (active) throw new SignInError("AUTH_BUSY");
      if (unsupportedMfa) throw new SignInError("AUTH_MFA_UNSUPPORTED");
      if (!ticket) throw new SignInError("AUTH_MFA_REQUIRED");
      if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw new SignInError("AUTH_INVALID_CODE");
      log.registerSecret(code);
      operation = { generation, controller: new AbortController() };
      active = operation;
      const body = { ticket, code, ...(loginInstanceId ? { login_instance_id: loginInstanceId } : {}) };
      const response = await send(TOTP_API, body, operation);
      code = "";
      return await result(response, operation, true);
    } catch (error) {
      if (error instanceof SignInError && error.code === "AUTH_BUSY") throw error;
      throw failure(error, operation, true);
    } finally {
      code = "";
      if (active === operation) active = null;
    }
  }

  return { start, completeTotp, clear };
}

module.exports = { createSignInSession };
