import { mothershipFactoryLabelRegistry } from "./mothership-label-overlay.ts";

export const CORE_LABEL_TYPES = Object.freeze([
  "lifecycle",
  "type",
  "state",
  "gate",
  "informational",
]);

const CORE_LABEL_TYPE_SET = new Set(CORE_LABEL_TYPES);

const REQUIRED_CORE_LABEL_NAMES = Object.freeze([
  "goal",
  "feature",
  "bug",
  "ready",
  "wave-in-progress",
  "triaged",
  "duplicate",
  "priorities",
  "artifacts",
  "telemetry",
  "quarantined",
  "deferred",
  "factory-tracking",
  "process",
  "human",
  "awaiting-human",
]);

const CORE_LABEL_OWNER_BY_NAME = Object.freeze({
  goal: "goal-queue-ops",
  feature: "write-issue-item",
  bug: "supervisor-artifact",
  ready: "wave-create-ready",
  "wave-in-progress": "wave-claim",
  triaged: "triage-apply-status",
  duplicate: "triage-apply-terminal-status",
  priorities: "supervisor-update-priorities-from-merge-failures",
  artifacts: "supervisor-artifact",
  telemetry: "supervisor-artifact",
  quarantined: "wave-handle-review-failures",
  deferred: "triage-apply-terminal-status",
  "factory-tracking": "supervisor-artifact",
  process: "supervisor-artifact",
  human: "human-blocker",
  "awaiting-human": "human-blocker",
});

const CORE_LABEL_TYPE_BY_NAME = Object.freeze({
  goal: "type",
  feature: "type",
  bug: "type",
  ready: "lifecycle",
  "wave-in-progress": "state",
  triaged: "state",
  duplicate: "state",
  priorities: "lifecycle",
  artifacts: "informational",
  telemetry: "informational",
  quarantined: "gate",
  deferred: "state",
  "factory-tracking": "informational",
  process: "informational",
  human: "gate",
  "awaiting-human": "gate",
});

const mergedRegistry = mothershipFactoryLabelRegistry();
const mergedLookup = new Map(mergedRegistry.map((entry) => [String(entry?.name || ""), entry]));

function requireLabel(name = "") {
  const label = mergedLookup.get(String(name || ""));
  if (!label) throw new Error(`CORE_LABEL_REGISTRY missing required label metadata for "${name}"`);
  return label;
}

export const CORE_LABEL_REGISTRY = Object.freeze(REQUIRED_CORE_LABEL_NAMES.map((name) => {
  const label = requireLabel(name);
  const type = CORE_LABEL_TYPE_BY_NAME[name];
  const owner = CORE_LABEL_OWNER_BY_NAME[name];
  if (!CORE_LABEL_TYPE_SET.has(type)) {
    throw new Error(`CORE_LABEL_REGISTRY has invalid type "${type}" for "${name}"`);
  }
  if (!String(owner || "").trim()) {
    throw new Error(`CORE_LABEL_REGISTRY has missing owner for "${name}"`);
  }
  return Object.freeze({
    name,
    description: String(label.description || "").trim(),
    color: String(label.color || "").trim(),
    type,
    owner,
  });
}));

export const CORE_LABEL_NAMES = Object.freeze(CORE_LABEL_REGISTRY.map((entry) => entry.name));

export const CORE_LABELS_FOR_SYNC = Object.freeze(CORE_LABEL_REGISTRY.map((entry) => Object.freeze({
  name: entry.name,
  description: entry.description,
  color: entry.color,
})));
