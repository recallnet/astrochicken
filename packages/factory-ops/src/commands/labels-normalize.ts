import { trim, gh, ghOrThrow } from "../lib/cli-helpers.ts";
import {
  FACTORY_LABEL_KEYS,
  getDefaultNormalizationLabelNames,
} from "../lib/factory-label-contract.ts";

const DEFAULT_FACTORY_ID = "mothership";
const DEFAULT_ALLOWED = getDefaultNormalizationLabelNames(DEFAULT_FACTORY_ID);

const HUMAN_GATE_LABELS = new Set([
  FACTORY_LABEL_KEYS.HUMAN,
  FACTORY_LABEL_KEYS.AWAITING_HUMAN,
].map((key) => {
  const defaults = {
    [FACTORY_LABEL_KEYS.HUMAN]: "human",
    [FACTORY_LABEL_KEYS.AWAITING_HUMAN]: "awaiting-human",
  };
  return defaults[key];
}));
const ESCALATION_MARKERS = ["INSTRUCTION_CONFLICT", "THRASH_NO_PROGRESS"];



function sanitizeIssueLabelToken(value = "") {
  return String(value || "").trim();
}

export function normalizeIssueLabelList(labelsRaw = "") {
  const raw = labelsRaw == null ? "" : String(labelsRaw);
  // Keep normalization deterministic without any historical denylist behavior:
  // trim, drop blanks, then preserve first-seen order.
  const parts = raw.split(",").map((value) => sanitizeIssueLabelToken(value)).filter(Boolean);
  const seen = new Set();
  const ordered = [];
  for (const label of parts) {
    if (seen.has(label)) continue;
    seen.add(label);
    ordered.push(label);
  }
  return ordered;
}

export function normalizeAndEnsureIssueLabels({
  repo = "",
  labelsRaw = "",
  factoryId = DEFAULT_FACTORY_ID,
  color = "ededed",
  description = "auto-created",
  createLabel,
} = {}) {
  const labels = normalizeIssueLabelList(labelsRaw);
  const ensureLabel = typeof createLabel === "function"
    ? createLabel
    : ({ label }) => gh(["label", "create", label, "--repo", repo, "--color", color, "--description", description]);

  for (const label of labels) {
    try {
      ensureLabel({ repo, label, color, description });
    } catch {
      // Non-fatal parity with legacy inline command (check=False)
    }
  }

  return labels.join(",");
}

export function hasEscalationMarker(text = "") {
  const t = String(text || "");
  return ESCALATION_MARKERS.some((m) => t.includes(m));
}

export function computeLabelsToRemove({ labels = [], allow = new Set(), markerText = "" } = {}) {
  const current = (Array.isArray(labels) ? labels : []).map((x) => String(x).trim()).filter(Boolean);
  const hasMarker = hasEscalationMarker(markerText);
  return current.filter((l) => {
    if (HUMAN_GATE_LABELS.has(l)) return !hasMarker;
    return !allow.has(l);
  });
}

export async function normalizeIssueLabels({ repo, allowed = DEFAULT_ALLOWED, state = "open", dryRun = false, issues = null } = {}) {
  if (!repo) throw new Error("repo is required");
  const allow = new Set((Array.isArray(allowed) ? allowed : DEFAULT_ALLOWED).map((x) => String(x).trim()).filter(Boolean));
  const listedIssues = Array.isArray(issues)
    ? issues
    : JSON.parse(String(ghOrThrow([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    state,
    "--limit",
    "200",
    "--json",
    "number,title,body,labels",
  ]).stdout || "[]"));

  const out = { repo, state, allowed: Array.from(allow), changed: 0, removed: 0, issues: [] };

  for (const issue of listedIssues) {
    const labels = (issue.labels || []).map((l) => l.name).filter(Boolean);
    const markerText = `${issue.title || ""}\n\n${issue.body || ""}`;
    const toRemove = computeLabelsToRemove({ labels, allow, markerText });
    if (toRemove.length === 0) continue;

    if (!dryRun) {
      for (const label of toRemove) {
        gh(["issue", "edit", String(issue.number), "--repo", repo, "--remove-label", label]);
      }
    }

    out.changed += 1;
    out.removed += toRemove.length;
    out.issues.push({ issue_number: issue.number, removed_labels: toRemove });
  }

  return out;
}
