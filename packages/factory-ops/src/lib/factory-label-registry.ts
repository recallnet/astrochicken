export const FACTORY_LABEL_CATEGORIES = Object.freeze([
  "type",
  "state",
  "queue",
  "control",
  "artifact",
]);

const CATEGORY_SET = new Set(FACTORY_LABEL_CATEGORIES);

const WAVE_READY_LABEL_METADATA = Object.freeze({
  ready: Object.freeze({
    description: "Ready for execution",
    color: "0e8a16",
  }),
  "wave-in-progress": Object.freeze({
    description: "Wave currently executing",
    color: "fbca04",
  }),
  priorities: Object.freeze({
    description: "Current priorities",
    color: "5319e7",
  }),
  quarantined: Object.freeze({
    description: "Temporarily quarantined after repeated review failures",
    color: "b60205",
  }),
});

const DEFAULT_COLOR = "ededed";

function buildLabelEntry({
  name,
  category,
  owner,
  description,
  color = DEFAULT_COLOR,
  includeByDefault = true,
  waveReady = false,
}) {
  return Object.freeze({
    name: String(name || "").trim(),
    category: String(category || "").trim(),
    owner: String(owner || "").trim(),
    description: String(description || "").trim(),
    color: String(color || DEFAULT_COLOR).trim() || DEFAULT_COLOR,
    include_by_default: Boolean(includeByDefault),
    wave_ready: Boolean(waveReady),
  });
}

function waveReadyMetadata(name) {
  return WAVE_READY_LABEL_METADATA[name] || null;
}

const BASE_LABELS = [
  { name: "goal", category: "type", owner: "goal_queue", description: "Goal issue tracked by supervisor dispatch queue." },
  { name: "feature", category: "type", owner: "goal_run", description: "Decomposed implementation work item." },
  { name: "bug", category: "type", owner: "supervisor", description: "Bug issue requiring remediation." },
  { name: "ready", category: "state", owner: "wave_dispatch", description: "Ready for execution", color: "0e8a16", waveReady: true },
  { name: "wave-in-progress", category: "state", owner: "wave_execute", description: "Wave currently executing", color: "fbca04", waveReady: true },
  { name: "triaged", category: "state", owner: "triage", description: "Issue assigned to a wave milestone." },
  { name: "duplicate", category: "control", owner: "triage", description: "Issue marked as duplicate and not actionable." },
  { name: "priorities", category: "queue", owner: "supervisor", description: "Current priorities", color: "5319e7", waveReady: true },
  { name: "artifacts", category: "artifact", owner: "supervisor", description: "Machine-generated artifacts and run evidence." },
  { name: "telemetry", category: "artifact", owner: "supervisor", description: "Operational telemetry and diagnostics." },
  { name: "quarantined", category: "control", owner: "wave_review", description: "Temporarily quarantined after repeated review failures", color: "b60205", waveReady: true },
  { name: "deferred", category: "control", owner: "supervisor", description: "Issue intentionally deferred." },
  { name: "factory-tracking", category: "control", owner: "supervisor", description: "Factory-internal tracking signal." },
  { name: "process", category: "control", owner: "supervisor", description: "Process/governance tracking signal." },
];

export const globalFactoryLabelRegistry = Object.freeze(BASE_LABELS.map((label) => {
  const metadata = waveReadyMetadata(label.name);
  return buildLabelEntry({
    ...label,
    description: metadata?.description || label.description,
    color: metadata?.color || label.color || DEFAULT_COLOR,
  });
}));

const DUPLICATE_NAMES = (() => {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of globalFactoryLabelRegistry) {
    if (seen.has(entry.name)) duplicates.add(entry.name);
    seen.add(entry.name);
  }
  return [...duplicates].sort((a, b) => a.localeCompare(b));
})();

if (DUPLICATE_NAMES.length > 0) {
  throw new Error(`globalFactoryLabelRegistry has duplicate label names: ${DUPLICATE_NAMES.join(", ")}`);
}

for (const entry of globalFactoryLabelRegistry) {
  if (!CATEGORY_SET.has(entry.category)) {
    throw new Error(`globalFactoryLabelRegistry contains invalid category \"${entry.category}\" for label \"${entry.name}\"`);
  }
}

function labelLookupFromRegistry(registry = globalFactoryLabelRegistry) {
  return new Map((Array.isArray(registry) ? registry : [])
    .map((entry) => [String(entry?.name || "").trim(), entry])
    .filter(([name]) => Boolean(name)));
}

export function findFactoryLabelByName(name = "", registry = globalFactoryLabelRegistry) {
  const key = String(name || "").trim();
  if (!key) return null;
  const lookup = labelLookupFromRegistry(registry);
  return lookup.get(key) || null;
}

export function defaultAllowedFactoryLabelNames(registry = globalFactoryLabelRegistry) {
  return (Array.isArray(registry) ? registry : [])
    .filter((entry) => entry.include_by_default)
    .map((entry) => entry.name);
}

export function waveReadyFactoryLabelNames(registry = globalFactoryLabelRegistry) {
  return (Array.isArray(registry) ? registry : [])
    .filter((entry) => entry.wave_ready)
    .map((entry) => entry.name);
}
