import { readFileSync } from "node:fs";

function readPrompt(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8").trimEnd();
}

export const SCOPE_SCENARIOS_PROMPT: string = readPrompt("./prompts/scope-scenarios.md");
export const REPAIR_SCOPE_PROMPT: string = readPrompt("./prompts/repair-scope.md");
export const WRITE_SCENARIO_PROMPT: string = readPrompt("./prompts/write-scenario.md");
export const REPAIR_SCENARIO_PROMPT: string = readPrompt("./prompts/repair-scenario.md");
