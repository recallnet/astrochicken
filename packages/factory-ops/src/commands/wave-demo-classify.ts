import { parseJson, trim } from "../lib/cli-helpers.ts";

const DEMO_POLICIES = new Set(["auto", "terminal", "browser", "none"]);

const BROWSER_SIGNAL_PATTERN = /\b(ui|ux|frontend|front-end|web|browser|page|screen|screenshot|playwright|storybook|react|vue|css|html)\b/i;
const TERMINAL_SIGNAL_PATTERN = /\b(cli|command-line|terminal|shell|stdout|stderr|tty|asciinema)\b/i;

function normalizeDemoPolicy(demoStrategy = "") {
  const normalized = trim(demoStrategy).toLowerCase();
  if (DEMO_POLICIES.has(normalized)) {
    return { policy: normalized, policyReasonCodes: [] };
  }

  return {
    policy: "auto",
    policyReasonCodes: normalized ? ["DEMO_POLICY_INVALID_FALLBACK_AUTO"] : ["DEMO_POLICY_DEFAULT_AUTO"],
  };
}

function normalizeMergedResults(mergedResultsRaw = "") {
  const parsed = parseJson(String(mergedResultsRaw || "[]"), []);
  const mergedResults = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object" && Array.isArray(parsed.merged_results) ? parsed.merged_results : []);

  return mergedResults
    .map((entry) => {
      if (entry && typeof entry === "object") return entry;
      if (typeof entry !== "string") return null;
      const decoded = parseJson(entry, null);
      return decoded && typeof decoded === "object" ? decoded : null;
    })
    .filter(Boolean);
}

function normalizeIssueMetadata(issueMetadataRaw = "") {
  const parsed = parseJson(String(issueMetadataRaw || "{}"), {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

function collectTextSignals(value, out = []) {
  if (value === null || value === undefined) return out;
  if (typeof value === "string") {
    const normalized = trim(value);
    if (normalized) out.push(normalized);
    return out;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextSignals(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      collectTextSignals(value[key], out);
    }
  }
  return out;
}

function resolveAutoStrategy({ mergedResults = [], issueMetadata = {} } = {}) {
  const allSignals = [
    ...collectTextSignals(issueMetadata),
    ...collectTextSignals(mergedResults),
  ];

  const hasBrowserSignal = allSignals.some((signal) => BROWSER_SIGNAL_PATTERN.test(signal));
  if (hasBrowserSignal) {
    return {
      demo_strategy: "browser",
      reason_codes: ["DEMO_AUTO_BROWSER_SIGNAL"],
    };
  }

  const hasTerminalSignal = allSignals.some((signal) => TERMINAL_SIGNAL_PATTERN.test(signal));
  if (hasTerminalSignal) {
    return {
      demo_strategy: "terminal",
      reason_codes: ["DEMO_AUTO_TERMINAL_SIGNAL"],
    };
  }

  return {
    demo_strategy: "none",
    reason_codes: ["DEMO_AUTO_NO_QUALIFYING_SIGNAL"],
  };
}

function toTelemetryMap({ pipeline = "", policy = "", demoStrategy = "", decision = "", noDemo = false, reasonCodes = [] } = {}) {
  return {
    "hatch.wave_demo.pipeline": String(pipeline),
    "hatch.wave_demo.policy": String(policy),
    "hatch.wave_demo.strategy": String(demoStrategy),
    "hatch.wave_demo.decision": String(decision),
    "hatch.wave_demo.no_demo": noDemo ? "true" : "false",
    "hatch.wave_demo.reason_codes": JSON.stringify(reasonCodes),
    "hatch.wave_demo.reason_code_primary": String(reasonCodes[0] || ""),
  };
}

/**
 * Deterministic wave demo strategy classifier.
 *
 * Precedence rules:
 * 1) Forced policy (none|terminal|browser) wins.
 * 2) No merged results => none.
 * 3) In auto, choose browser on explicit UI/web signals.
 * 4) In auto, choose terminal on explicit CLI/terminal signals.
 * 5) In auto, fall back to none when no qualifying signal exists.
 */
export function classifyWaveDemoStrategy({
  mergedResultsRaw = "[]",
  issueMetadataRaw = "{}",
  demoStrategy = "auto",
  pipeline = "wave_execute",
} = {}) {
  const { policy, policyReasonCodes } = normalizeDemoPolicy(demoStrategy);
  const mergedResults = normalizeMergedResults(mergedResultsRaw);
  const issueMetadata = normalizeIssueMetadata(issueMetadataRaw);

  let demo_strategy = "none";
  let reason_codes = [...policyReasonCodes];

  if (policy === "none") {
    demo_strategy = "none";
    reason_codes.push("DEMO_POLICY_FORCED_NONE");
  } else if (policy === "terminal") {
    demo_strategy = "terminal";
    reason_codes.push("DEMO_POLICY_FORCED_TERMINAL");
  } else if (policy === "browser") {
    demo_strategy = "browser";
    reason_codes.push("DEMO_POLICY_FORCED_BROWSER");
  } else if (mergedResults.length === 0) {
    demo_strategy = "none";
    reason_codes.push("DEMO_NO_MERGED_RESULTS");
  } else {
    const autoDecision = resolveAutoStrategy({ mergedResults, issueMetadata });
    demo_strategy = autoDecision.demo_strategy;
    reason_codes.push(...autoDecision.reason_codes);
  }

  if (reason_codes.length === 0) {
    reason_codes = ["DEMO_CLASSIFICATION_FALLBACK"];
  }

  const no_demo = demo_strategy === "none";
  const demo_decision = no_demo ? "skip" : "generate";

  return {
    demo_strategy,
    demo_decision,
    reason_codes,
    no_demo,
    telemetry: toTelemetryMap({
      pipeline: trim(pipeline) || "wave_execute",
      policy,
      demoStrategy: demo_strategy,
      decision: demo_decision,
      noDemo: no_demo,
      reasonCodes: reason_codes,
    }),
  };
}
