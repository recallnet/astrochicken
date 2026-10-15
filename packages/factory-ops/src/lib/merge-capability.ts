import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadGraphSemanticsText } from "@hatch/factory-core/graph-source-loader";

const FACTORY_OPS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CAPABILITY_MERGE_GRAPH_PATH = resolve(FACTORY_OPS_ROOT, "../capability-merge/workflows/merge_item/merge_item.workflow-source.mjs");
const CAPABILITY_MERGE_SKILL_PATH = resolve(FACTORY_OPS_ROOT, "../capability-merge/skills/merge_conflict_resolver/SKILL.md");

export function readCapabilityMergeGraphDot() {
  // @context:regression Canonical typed workflow sources replace deleted DOT inputs.
  return loadGraphSemanticsText(CAPABILITY_MERGE_GRAPH_PATH);
}

export function readCapabilityMergeSkillMarkdown() {
  return readFileSync(CAPABILITY_MERGE_SKILL_PATH, "utf8");
}
