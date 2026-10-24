import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, parsePlan, validateForm } from "./public/planner.js";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const hits = new Map();
function isRateLimited(ip, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

function readBody(req, limit = 32_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function callModel(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw await upstreamError("Anthropic", res);
  const data = await res.json();
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

async function upstreamError(name, res, body) {
  const detail = body ?? (await res.text().catch(() => ""));
  console.error(`${name} API ${res.status}: ${detail.slice(0, 500)}`);
  return Object.assign(new Error(`Upstream error ${res.status}`), { status: res.status });
}

// Free-tier friendly: try these Flash models in order and skip any that is out of quota or retired.
const FREE_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"];
let activeModel = FREE_MODELS[0];
const blocked = new Map(); // model -> time until which it is skipped
const modelOrder = () => [...new Set([process.env.GEMINI_MODEL, ...FREE_MODELS].filter(Boolean))];

function geminiRequest(model, prompt) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 16384, temperature: 0.8 },
    }),
    signal: AbortSignal.timeout(90_000),
  });
}

// Used only when every model above is retired: ask Google which Flash models this key can call.
async function listGeminiModels() {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw await upstreamError("Gemini models", res);
  const { models = [] } = await res.json();
  const version = (name) => parseFloat(name.match(/\d+(\.\d+)?/)[0]);
  return models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /^models\/gemini-[\d.]+-flash(-lite)?(-preview)?$/.test(m.name))
    .map((m) => m.name.replace("models/", ""))
    .sort((a, b) => version(b) - version(a) || a.includes("preview") - b.includes("preview"));
}

const TRANSIENT = new Set([500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Free-tier Gemini is often "overloaded" (503) or out of quota (429). Try every model, then retry a few times.
async function callGemini(prompt) {
  let failure;
  const attempt = async (models, tried) => {
    for (const model of models) {
      if (tried.has(model) || (blocked.get(model) ?? 0) > Date.now()) continue;
      tried.add(model);
      const res = await geminiRequest(model, prompt);
      if (res.ok) {
        activeModel = model;
        const data = await res.json();
        return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      }
      const detail = await res.text().catch(() => "");
      console.error(`Gemini ${model}: ${res.status} ${detail.slice(0, 300)}`);
      failure = Object.assign(new Error(`Upstream error ${res.status}`), { status: res.status });
      if (res.status === 404) blocked.set(model, Date.now() + 3_600_000);
      else if (res.status === 429) blocked.set(model, Date.now() + 120_000);
      else if (!TRANSIENT.has(res.status)) throw failure;
    }
    return null;
  };
  for (let pass = 0; pass < 3; pass++) {
    const tried = new Set();
    let text = await attempt(modelOrder(), tried);
    if (text === null && failure?.status === 404) text = await attempt(await listGeminiModels(), tried);
    if (text !== null) return text;
    if (!failure || !TRANSIENT.has(failure.status)) break;
    await sleep(1500 * (pass + 1));
  }
  throw failure ?? Object.assign(new Error("No Gemini model available"), { status: 429 });
}

// Identical first-time requests are answered from memory for 30 minutes, which saves free-tier quota.
const cache = new Map();
const CACHE_MS = 30 * 60_000;
const cacheKey = (f) => JSON.stringify([f.type, f.who, f.date, f.guests, f.budget, f.currency, f.city, f.vibe, f.notes]);

// Google Gemini is used when GEMINI_API_KEY is set; otherwise Anthropic Claude (ANTHROPIC_API_KEY).
const generate = (prompt) => (process.env.GEMINI_API_KEY ? callGemini(prompt) : callModel(prompt));

const UPSTREAM_MESSAGES = {
  400: "The AI provider rejected the request. Check the API key and credits.",
  401: "The AI key was rejected. Check the API key on the server.",
  403: "The AI key is not allowed to use this model.",
  404: "AI model not found. Check the model setting.",
  429: "AI is busy. Try again in a minute.",
  503: "AI is overloaded. Try again shortly.",
  529: "AI is overloaded. Try again shortly.",
};

async function handle(req, res) {
  const send = (code, body, type = "application/json") => {
    res.writeHead(code, { ...SECURITY_HEADERS, "Content-Type": type });
    res.end(Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body));
  };
  try {
    if (req.method === "POST" && req.url === "/api/plan") {
      if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) return send(503, { error: "AI is not configured on this server." });
      if (isRateLimited(req.socket.remoteAddress)) return send(429, { error: "Too many requests. Try again in a minute." });
      const { form, plan, change } = JSON.parse(await readBody(req));
      const errors = validateForm(form ?? {});
      if (errors.length) return send(400, { errors });
      const request = String(change ?? "").slice(0, MAX_CHANGE);
      const key = request ? null : cacheKey(form);
      const hit = key && cache.get(key);
      if (hit && hit.expires > Date.now()) return send(200, hit.plan);
      const text = await generate(buildPrompt(form, plan, request));
      let parsed;
      try {
        parsed = parsePlan(text);
      } catch {
        console.error("Unreadable AI reply:", text.slice(0, 300));
        return send(502, { error: "The AI reply could not be read. Please try again." });
      }
      const used = process.env.GEMINI_API_KEY ? activeModel : process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
      const result = { ...parsed, model: used };
      if (key) {
        cache.set(key, { plan: result, expires: Date.now() + CACHE_MS });
        if (cache.size > 100) cache.delete(cache.keys().next().value);
      }
      return send(200, result);
    }
    if (req.method === "GET") {
      const pathname = decodeURIComponent(req.url.split("?")[0]);
      const file = normalize(join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname));
      const type = MIME[extname(file)];
      if (!file.startsWith(PUBLIC_DIR) || !type) return send(404, "Not found", "text/plain");
      try { return send(200, await readFile(file), type); } catch { return send(404, "Not found", "text/plain"); }
    }
    return send(405, { error: "Method not allowed." });
  } catch (err) {
    console.error(err);
    if (err.message === "too large") return send(413, { error: "Request too large." });
    if (err.status) return send(502, { error: UPSTREAM_MESSAGES[err.status] ?? "The AI service returned an error." });
    if (err.name === "TimeoutError") return send(504, { error: "The AI took too long. Please try again." });
    if (err instanceof SyntaxError || err instanceof URIError) return send(400, { error: "Bad request." });
    return send(500, { error: "Something went wrong. Please try again." });
  }
}

const MAX_CHANGE = 300;
http.createServer(handle).listen(PORT, () => console.log(`Plan·it running at http://localhost:${PORT}`));
