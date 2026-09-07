import assert from "node:assert/strict";
import test from "node:test";

import {
  callLlmJson,
  extractJsonObjectFromText,
} from "../../src/lib/analysis/llm-call.ts";

test("extractJsonObjectFromText accepts fenced JSON payloads", () => {
  const payload = extractJsonObjectFromText("```json\n{\"ok\":true,\"value\":1}\n```");
  assert.deepEqual(payload, { ok: true, value: 1 });
});

test("callLlmJson uses OpenRouter when OPENROUTER_API_KEY is configured", async () => {
  const calls = [];
  const payload = await callLlmJson({
    model: "claude-sonnet-4-6",
    prompt: "Return JSON only",
    env: {
      OPENROUTER_API_KEY: "or-key",
    },
    fetchFn: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: "{\"focus_choices\":{\"prioritized_elevations\":[\"factory_instance\"]}}",
                },
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].options.headers.authorization, "Bearer or-key");
  const body = JSON.parse(String(calls[0].options.body));
  assert.equal(body.model, "anthropic/claude-sonnet-4.6");
  assert.deepEqual(payload, {
    focus_choices: {
      prioritized_elevations: ["factory_instance"],
    },
  });
});
