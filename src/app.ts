import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, parsePlan, sanitizePlan, validateForm, type EventForm, type Plan } from "../public/planner.ts";
import { createGemini, UpstreamError, type Env, type Gemini } from "./gemini.ts";
import { createRateLimiter, type RateLimiter } from "./rateLimit.ts";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const UPSTREAM_MESSAGES: Record<number, string> = {
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

class PayloadTooLargeError extends Error {
  status = 413;
}

export interface AppOptions {
  env?: Env;
  fetchImpl?: typeof fetch;
  limiter?: RateLimiter;
  gemini?: Gemini;
}

/** Real visitor address. Behind a trusted proxy (Render) the proxy's own address would be shared by everyone. */
export function clientIp(req: Pick<IncomingMessage, "headers" | "socket">, env: Env = process.env): string {
  const trusted = env.TRUST_PROXY === "true" || Boolean(env.RENDER);
  const forwarded = trusted ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
  return forwarded || req.socket.remoteAddress || "unknown";
}

function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        if (!rejected) reject(new PayloadTooLargeError("Request too large"));
        rejected = true;
      } else if (!rejected) {
        chunks.push(chunk);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

/** Browsers cannot run TypeScript, so the .ts files in public/ are served with their types stripped (no build step). */
const stripped = new Map<string, string>();
async function readAsset(file: string): Promise<string | Buffer> {
  if (!file.endsWith(".ts")) return readFile(file);
  let js = stripped.get(file);
  if (js === undefined) {
    js = stripTypeScriptTypes(await readFile(file, "utf8"));
    stripped.set(file, js);
  }
  return js;
}

export function createApp({ env = process.env, fetchImpl, limiter = createRateLimiter(), gemini = createGemini({ env, fetchImpl }) }: AppOptions = {}) {
  const cache = new Map<string, { plan: Plan; expires: number }>();
  const cacheKey = (f: EventForm) => JSON.stringify([f.type, f.who, f.date, f.guests, f.budget, f.currency, f.city, f.vibe, f.notes]);

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (code: number, body: unknown, type: string, extra: Record<string, string> = {}) => {
      res.writeHead(code, { ...SECURITY_HEADERS, "Content-Type": type, ...extra });
      res.end(Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body));
    };
    const json = (code: number, body: unknown, extra: Record<string, string> = {}) =>
      send(code, body, "application/json; charset=utf-8", { "Cache-Control": "no-store", ...extra });

    try {
      if (req.method === "POST" && req.url === "/api/plan") {
        if (!env.GEMINI_API_KEY) return json(503, { error: "AI is not configured on this server." });
        if (limiter.isLimited(clientIp(req, env))) return json(429, { error: "Too many requests. Try again in a minute." });
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(415, { error: "Send JSON." });
        const body = JSON.parse(await readBody(req)) as { form?: EventForm; plan?: unknown; change?: unknown };
        const errors = validateForm(body.form ?? {});
        if (errors.length || !body.form) return json(400, { errors });
        const form = body.form;
        const change = String(body.change ?? "").slice(0, MAX_CHANGE).trim();
        const safePlan = change ? sanitizePlan(body.plan) : null;
        if (change && !safePlan) return json(400, { error: "The current plan is invalid." });

        const key = change ? null : cacheKey(form);
        const hit = key ? cache.get(key) : undefined;
        if (hit && hit.expires > Date.now()) return json(200, hit.plan);

        const text = await gemini.generate(buildPrompt(form, safePlan, change));
        let parsed: Plan;
        try {
          parsed = parsePlan(text);
        } catch {
          console.error("Unreadable AI reply:", text.slice(0, 300));
          return json(502, { error: "The AI reply could not be read. Please try again." });
        }
        const result: Plan = { ...parsed, model: gemini.model };
        if (key) {
          cache.set(key, { plan: result, expires: Date.now() + CACHE_MS });
          if (cache.size > 100) cache.delete(cache.keys().next().value as string);
        }
        return json(200, result);
      }

      if (req.method === "GET" || req.method === "HEAD") {
        const pathname = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const file = normalize(join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname));
        const type = MIME[extname(file)];
        if (!file.startsWith(PUBLIC_DIR) || !type) return send(404, "Not found", "text/plain; charset=utf-8");
        try {
          return send(200, await readAsset(file), type, { "Cache-Control": "no-cache" });
        } catch {
          return send(404, "Not found", "text/plain; charset=utf-8");
        }
      }
      return json(405, { error: "Method not allowed." });
    } catch (err) {
      if (err instanceof PayloadTooLargeError) return json(413, { error: "Request too large." }, { Connection: "close" });
      if (err instanceof UpstreamError) return json(502, { error: UPSTREAM_MESSAGES[err.status] ?? "The AI service returned an error." });
      if (err instanceof Error && err.name === "TimeoutError") return json(504, { error: "The AI took too long. Please try again." });
      if (err instanceof SyntaxError || err instanceof URIError) return json(400, { error: "Bad request." });
      console.error(err);
      return json(500, { error: "Something went wrong. Please try again." });
    }
  };
}
