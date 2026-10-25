export type Env = Record<string, string | undefined>;

export class UpstreamError extends Error {
  status: number;

  constructor(status: number) {
    super(`Upstream error ${status}`);
    this.status = status;
  }
}

export interface GeminiOptions {
  env?: Env;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  /** Ask Google which Flash models this key can use (cached for six hours). Switched off in tests. */
  discover?: boolean;
}

export interface Gemini {
  generate(prompt: string): Promise<string>;
  /** The model that answered most recently. */
  readonly model: string;
}

type ModelInfo = { name: string; supportedGenerationMethods?: string[] };
type GenerateReply = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

const API = "https://generativelanguage.googleapis.com/v1beta";
const FREE_MODELS: readonly string[] = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"];
const TRANSIENT = new Set([500, 502, 503, 504]);
const DISCOVERY_TTL_MS = 6 * 60 * 60_000;
const DISCOVERY_RETRY_MS = 5 * 60_000;

/**
 * Gemini client that stays on free-tier Flash models. It asks Google for the newest Flash models the key can call,
 * skips a model for a while when it is out of quota (429) or retired (404), and retries overloaded replies (5xx).
 */
export function createGemini({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
  sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  log = console.error,
  discover = true,
}: GeminiOptions = {}): Gemini {
  const blocked = new Map<string, number>();
  let discovered: { models: string[]; at: number } | undefined;
  let activeModel = FREE_MODELS[0];

  const request = (model: string, prompt: string) =>
    fetchImpl(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 16384, temperature: 0.8 },
      }),
      signal: AbortSignal.timeout(90_000),
    });

  async function listModels(): Promise<string[]> {
    const res = await fetchImpl(`${API}/models?pageSize=200`, {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new UpstreamError(res.status);
    const { models = [] } = (await res.json()) as { models?: ModelInfo[] };
    const version = (name: string) => parseFloat(name.match(/\d+(\.\d+)?/)?.[0] ?? "0");
    return models
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /^models\/gemini-[\d.]+-flash(-lite)?(-preview)?$/.test(m.name))
      .map((m) => m.name.replace("models/", ""))
      .toSorted((a, b) => version(b) - version(a) || Number(a.includes("preview")) - Number(b.includes("preview")))
      .slice(0, 4);
  }

  /** Models to try, best first: the configured one, the newest Google offers, then the built-in free list. */
  async function candidates(): Promise<string[]> {
    if (discover && (!discovered || now() - discovered.at > DISCOVERY_TTL_MS)) {
      try {
        discovered = { models: await listModels(), at: now() };
      } catch (err) {
        log(`Gemini model discovery failed: ${err instanceof Error ? err.message : String(err)}`);
        discovered = { models: [], at: now() - DISCOVERY_TTL_MS + DISCOVERY_RETRY_MS };
      }
    }
    return [...new Set([env.GEMINI_MODEL, ...(discovered?.models ?? []), ...FREE_MODELS])].filter((m): m is string => Boolean(m));
  }

  async function generate(prompt: string): Promise<string> {
    let failure: UpstreamError | undefined;
    for (let pass = 0; pass < 3; pass++) {
      for (const model of await candidates()) {
        if ((blocked.get(model) ?? 0) > now()) continue;
        const res = await request(model, prompt);
        if (res.ok) {
          activeModel = model;
          const data = (await res.json()) as GenerateReply;
          return (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
        }
        log(`Gemini ${model}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
        failure = new UpstreamError(res.status);
        if (res.status === 404) blocked.set(model, now() + 3_600_000);
        else if (res.status === 429) blocked.set(model, now() + 120_000);
        else if (!TRANSIENT.has(res.status)) throw failure;
      }
      if (!failure || !TRANSIENT.has(failure.status)) break;
      await sleep(1500 * (pass + 1));
    }
    throw failure ?? new UpstreamError(429);
  }

  return {
    generate,
    get model() {
      return activeModel;
    },
  };
}
