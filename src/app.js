import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, parsePlan, sanitizePlan, validateForm } from "../public/planner.js";
import { createGemini, UpstreamError } from "./gemini.js";
import { createRateLimiter } from "./rateLimit.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const UPSTREAM_MESSAGES = {
  400: "The AI provider rejected the request. Check the API key.",
  401: "The AI key was rejected. Check the API key on the server.",
  403: "The AI key is not allowed to use this model.",
  404: "AI model not found. Check the model setting.",
  429: "AI is busy. Try again in a minute.",
  503: "AI is overloaded. Try again shortly.",
};
const MAX_BODY = 32_000;
const MAX_CHANGE = 300;
const CACHE_MS = 30 * 60_000;

/** Real visitor address. Behind a trusted proxy (Render) the proxy's own address would be shared by everyone. */
export function clientIp(req, env = process.env) {
  const trusted = env.TRUST_PROXY === "true" || Boolean(env.RENDER);
  const forwarded = trusted ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
  return forwarded || req.socket.remoteAddress || "unknown";
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        if (!rejected) reject(Object.assign(new Error("too large"), { status: 413 }));
        rejected = true;
      } else if (!rejected) chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

export function createApp({ env = process.env, fetchImpl, limiter = createRateLimiter(), gemini = createGemini({ env, fetchImpl }) } = {}) {
  const cache = new Map();
  const cacheKey = (f) => JSON.stringify([f.type, f.who, f.date, f.guests, f.budget, f.currency, f.city, f.vibe, f.notes]);

  return async function handle(req, res) {
    const send = (code, body, type, extra = {}) => {
      res.writeHead(code, { ...SECURITY_HEADERS, "Content-Type": type, ...extra });
      res.end(Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body));
    };
    const json = (code, body, extra = {}) => send(code, body, "application/json; charset=utf-8", { "Cache-Control": "no-store", ...extra });

    try {
      if (req.method === "POST" && req.url === "/api/plan") {
        if (!env.GEMINI_API_KEY) return json(503, { error: "AI is not configured on this server." });
        if (limiter.isLimited(clientIp(req, env))) return json(429, { error: "Too many requests. Try again in a minute." });
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(415, { error: "Send JSON." });
        const { form, plan, change } = JSON.parse(await readBody(req));
        const errors = validateForm(form ?? {});
        if (errors.length) return json(400, { errors });
        const request = String(change ?? "").slice(0, MAX_CHANGE).trim();
        const safePlan = request ? sanitizePlan(plan) : null;
        if (request && !safePlan) return json(400, { error: "The current plan is invalid." });

        const key = request ? null : cacheKey(form);
        const hit = key && cache.get(key);
        if (hit && hit.expires > Date.now()) return json(200, hit.plan);

        const text = await gemini.generate(buildPrompt(form, safePlan, request));
        let parsed;
        try {
          parsed = parsePlan(text);
        } catch {
          console.error("Unreadable AI reply:", text.slice(0, 300));
          return json(502, { error: "The AI reply could not be read. Please try again." });
        }
        const result = { ...parsed, model: gemini.model };
        if (key) {
          cache.set(key, { plan: result, expires: Date.now() + CACHE_MS });
          if (cache.size > 100) cache.delete(cache.keys().next().value);
        }
        return json(200, result);
      }

      if (req.method === "GET" || req.method === "HEAD") {
        const pathname = decodeURIComponent(req.url.split("?")[0]);
        const file = normalize(join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname));
        const type = MIME[extname(file)];
        if (!file.startsWith(PUBLIC_DIR) || !type) return send(404, "Not found", "text/plain; charset=utf-8");
        try {
          return send(200, await readFile(file), type, { "Cache-Control": "no-cache" });
        } catch {
          return send(404, "Not found", "text/plain; charset=utf-8");
        }
      }
      return json(405, { error: "Method not allowed." });
    } catch (err) {
      if (err.status === 413) return json(413, { error: "Request too large." }, { Connection: "close" });
      if (err instanceof UpstreamError) return json(502, { error: UPSTREAM_MESSAGES[err.status] ?? "The AI service returned an error." });
      if (err.name === "TimeoutError") return json(504, { error: "The AI took too long. Please try again." });
      if (err instanceof SyntaxError || err instanceof URIError) return json(400, { error: "Bad request." });
      console.error(err);
      return json(500, { error: "Something went wrong. Please try again." });
    }
  };
}
