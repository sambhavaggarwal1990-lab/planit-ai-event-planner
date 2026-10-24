export class UpstreamError extends Error {
  constructor(status) {
    super(`Upstream error ${status}`);
    this.status = status;
  }
}

const API = "https://generativelanguage.googleapis.com/v1beta";
const FREE_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"];
const TRANSIENT = new Set([500, 502, 503, 504]);

/**
 * Gemini client that stays on free-tier Flash models. A model that is out of quota (429) or retired (404)
 * is skipped for a while, and overloaded replies (5xx) are retried across all models.
 */
export function createGemini({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.error,
} = {}) {
  const blocked = new Map();
  let activeModel = FREE_MODELS[0];
  const order = () => [...new Set([env.GEMINI_MODEL, ...FREE_MODELS].filter(Boolean))];

  const request = (model, prompt) =>
    fetchImpl(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 16384, temperature: 0.8 },
      }),
      signal: AbortSignal.timeout(90_000),
    });

  // Only used when every model above is retired: ask Google which Flash models this key can call.
  async function listModels() {
    const res = await fetchImpl(`${API}/models?pageSize=200`, {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new UpstreamError(res.status);
    const { models = [] } = await res.json();
    const version = (name) => parseFloat(name.match(/\d+(\.\d+)?/)[0]);
    return models
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /^models\/gemini-[\d.]+-flash(-lite)?(-preview)?$/.test(m.name))
      .map((m) => m.name.replace("models/", ""))
      .sort((a, b) => version(b) - version(a) || a.includes("preview") - b.includes("preview"));
  }

  async function generate(prompt) {
    let failure;
    const attempt = async (models, tried) => {
      for (const model of models) {
        if (tried.has(model) || (blocked.get(model) ?? 0) > now()) continue;
        tried.add(model);
        const res = await request(model, prompt);
        if (res.ok) {
          activeModel = model;
          const data = await res.json();
          return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        }
        log(`Gemini ${model}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
        failure = new UpstreamError(res.status);
        if (res.status === 404) blocked.set(model, now() + 3_600_000);
        else if (res.status === 429) blocked.set(model, now() + 120_000);
        else if (!TRANSIENT.has(res.status)) throw failure;
      }
      return null;
    };
    for (let pass = 0; pass < 3; pass++) {
      const tried = new Set();
      let text = await attempt(order(), tried);
      if (text === null && failure?.status === 404) text = await attempt(await listModels(), tried);
      if (text !== null) return text;
      if (!failure || !TRANSIENT.has(failure.status)) break;
      await sleep(1500 * (pass + 1));
    }
    throw failure ?? new UpstreamError(429);
  }

  return { generate, get model() { return activeModel; } };
}
