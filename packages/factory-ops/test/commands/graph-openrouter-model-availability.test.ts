import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

const graphDir = "factories/mothership/graphs";

function listGraphs() {
  return readdirSync(graphDir)
    .filter((name) => name.endsWith(".dot"))
    .map((name) => join(graphDir, name))
    .sort((a, b) => a.localeCompare(b));
}

function extractLlmModels(dot) {
  const values = [];
  const re = /llm_model\s*[:=]\s*"?([A-Za-z0-9._/-]+)"?/g;
  let m;
  while ((m = re.exec(dot)) !== null) {
    values.push(m[1]);
  }
  return values;
}

function toRegistryModelId(modelId) {
  return modelId.startsWith("openai/") ? modelId.slice("openai/".length) : modelId;
}

test("graph llm_model values resolve against openai-codex catalog", () => {
  const registry = new ModelRegistry(AuthStorage.create());
  const codexModels = new Set(
    registry.getAll().filter((m) => m.provider === "openai-codex").map((m) => m.id),
  );

  const missing = [];

  for (const dotPath of listGraphs()) {
    const dot = readFileSync(dotPath, "utf8");
    for (const modelId of extractLlmModels(dot)) {
      if (!codexModels.has(toRegistryModelId(modelId))) {
        missing.push(`${dotPath}: ${modelId}`);
      }
    }
  }

  assert.deepEqual(missing, [], `Unavailable openai-codex llm_model entries:\n${missing.join("\n")}`);
});
