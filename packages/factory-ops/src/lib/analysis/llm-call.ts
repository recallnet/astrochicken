function asString(value) {
  return String(value ?? "").trim();
}

function normalizeModel(model = "") {
  const normalized = asString(model);
  if (!normalized) return "anthropic/claude-sonnet-4.6";
  if (normalized.includes("/")) return normalized;

  const aliases = new Map([
    ["claude-sonnet-4-6", "anthropic/claude-sonnet-4.6"],
    ["claude-sonnet-4.6", "anthropic/claude-sonnet-4.6"],
    ["gpt-5.3-codex", "openai/gpt-5.3-codex"],
    ["gpt-5.1-codex-mini", "openai/gpt-5.1-codex-mini"],
  ]);
  return aliases.get(normalized) || normalized;
}

function extractTextFromOpenRouter(payload = {}) {
  const message = payload?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractTextFromAnthropic(payload = {}) {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  return content
    .map((part) => (part?.type === "text" ? asString(part.text) : ""))
    .filter(Boolean)
    .join("\n");
}

export function extractJsonObjectFromText(text = "") {
  const raw = asString(text);
  if (!raw) throw new Error("llm_response_empty");

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch {}

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("llm_response_invalid_json");
}

export async function callLlmJson({
  prompt = "",
  model = "claude-sonnet-4-6",
  system = "",
  fetchFn = globalThis.fetch,
  env = process.env,
} = {}) {
  if (typeof fetchFn !== "function") {
    throw new Error("llm_fetch_unavailable");
  }

  const normalizedModel = normalizeModel(model);
  const openRouterKey = asString(env?.OPENROUTER_API_KEY);
  const anthropicKey = asString(env?.ANTHROPIC_API_KEY);
  const openAiKey = asString(env?.OPENAI_API_KEY);

  if (openRouterKey) {
    const response = await fetchFn("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${openRouterKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: normalizedModel,
        response_format: { type: "json_object" },
        messages: [
          ...(asString(system) ? [{ role: "system", content: asString(system) }] : []),
          { role: "user", content: asString(prompt) },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`openrouter_http_${response.status}: ${body}`);
      error.code = `openrouter_http_${response.status}`;
      throw error;
    }

    const payload = await response.json();
    return extractJsonObjectFromText(extractTextFromOpenRouter(payload));
  }

  if (anthropicKey) {
    const response = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: normalizedModel.replace(/^anthropic\//, ""),
        max_tokens: 4000,
        system: asString(system),
        messages: [
          { role: "user", content: asString(prompt) },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`anthropic_http_${response.status}: ${body}`);
      error.code = `anthropic_http_${response.status}`;
      throw error;
    }

    const payload = await response.json();
    return extractJsonObjectFromText(extractTextFromAnthropic(payload));
  }

  if (openAiKey) {
    const response = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${openAiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: normalizedModel.replace(/^openai\//, ""),
        response_format: { type: "json_object" },
        messages: [
          ...(asString(system) ? [{ role: "system", content: asString(system) }] : []),
          { role: "user", content: asString(prompt) },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`openai_http_${response.status}: ${body}`);
      error.code = `openai_http_${response.status}`;
      throw error;
    }

    const payload = await response.json();
    return extractJsonObjectFromText(extractTextFromOpenRouter(payload));
  }

  const error = new Error("missing_analysis_runtime: set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY");
  error.code = "missing_analysis_runtime";
  throw error;
}
