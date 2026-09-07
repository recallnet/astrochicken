import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FACTORY_OPS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CAPABILITY_MERGE_GRAPH_PATH = resolve(FACTORY_OPS_ROOT, "../capability-merge/graphs/merge_item.dot");
const CAPABILITY_MERGE_SKILL_PATH = resolve(FACTORY_OPS_ROOT, "../capability-merge/skills/merge_conflict_resolver/SKILL.md");

export function readCapabilityMergeGraphDot() {
  return readFileSync(CAPABILITY_MERGE_GRAPH_PATH, "utf8");
}

export function readCapabilityMergeSkillMarkdown() {
  return readFileSync(CAPABILITY_MERGE_SKILL_PATH, "utf8");
}
