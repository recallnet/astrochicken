import { existsSync } from "node:fs";

import { loadGraphSemanticsText } from "@hatch/factory-core/graph-source-loader";

import { trim } from "../lib/cli-helpers.ts";

const REQUIRED_OUTPUT_KEY = "domain_result";

const SHELL_CONTEXT_KEYS = new Set([
  "factory_id",
  "factory_root",
  "kind_id",
  "instance_id",
  "target_repo",
  "target_repo",
  "control_plane_repo",
  "domain_graph",
  "shared_supervisor_shell",
  "destinations_json",
  "intake_json",
  "kind_context_json",
  "trust_domain",
  "trust_role",
  "repo",
  "runs_dir",
  "has_issue",
  "selected_issue_number",
  "selected_issue_title",
  "selected_issue_body",
  "manifest_ok",
  "manifest_error",
  "parse_error",
  "state_snapshot",
  "control_gate",
  "control_state_action",
  "control_state_reason",
  "has_open_upstream_bugs",
  "open_upstream_bug_count",
  "open_upstream_bug_numbers",
  "has_action_items",
  "action_item_count",
  "__composite_reason",
]);

const FORBIDDEN_PROMPT_RULES = [
  {
    code: "forbidden_control_state_write",
    regex: /hatch-ops\s+supervisor\s+managed-persist-state\b/gi,
    message: "Domain graph must not write managed lifecycle/control state.",
  },
  {
    code: "forbidden_lifecycle_classification",
    regex: /hatch-ops\s+supervisor\s+managed-health-classifier\b/gi,
    message: "Domain graph must not classify managed lifecycle state.",
  },
  {
    code: "forbidden_failure_classification",
    regex: /hatch-ops\s+supervisor\s+managed-failure-classifier\b/gi,
    message: "Domain graph must not classify failure ownership.",
  },
  {
    code: "forbidden_shell_telemetry",
    regex: /hatch-ops\s+supervisor\s+managed-emit-run-summary\b/gi,
    message: "Domain graph must not emit managed supervisor telemetry envelope.",
  },
  {
    code: "forbidden_upstream_bug_gate",
    regex: /hatch-ops\s+supervisor\s+upstream-bug-gate\b/gi,
    message: "Domain graph must not run upstream blocker gates.",
  },
  {
    code: "forbidden_control_gate",
    regex: /hatch-ops\s+supervisor\s+managed-control-gate\b/gi,
    message: "Domain graph must not evaluate control-state gate.",
  },
  {
    code: "forbidden_emit_bug",
    regex: /hatch-ops\s+supervisor\s+emit-bug\b/gi,
    message: "Domain graph must not escalate incidents directly via emit-bug.",
  },
];

const FORBIDDEN_OUTPUT_KEYS = new Set([
  "managed_run_summary",
  "lifecycle_state",
  "health_state",
  "failure_classification",
  "failure_reason",
  "control_gate",
  "control_state_action",
  "control_state_reason",
]);

function toLineNumber(input = "", index = 0) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (input[i] === "\n") line += 1;
  }
  return line;
}

function parseKeyList(raw = "") {
  return String(raw || "")
    .split(",")
    .map((value) => trim(value))
    .filter(Boolean);
}

function collectProducedKeyEntries(dot = "") {
  const entries = [];

  for (const attr of ["output_key", "outputs", "export_keys"]) {
    const regex = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "g");
    let match;
    while ((match = regex.exec(dot)) !== null) {
      const line = toLineNumber(dot, match.index);
      for (const key of parseKeyList(match[1])) {
        entries.push({ key, attr, line });
      }
    }
  }

  return entries;
}

function collectReferencedKeys(dot = "") {
  const refs = [];
  const regex = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let match;
  while ((match = regex.exec(dot)) !== null) {
    refs.push({ key: match[1], line: toLineNumber(dot, match.index) });
  }
  return refs;
}

function collectForbiddenPromptViolations(dot = "") {
  const violations = [];

  for (const rule of FORBIDDEN_PROMPT_RULES) {
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(dot)) !== null) {
      violations.push({
        code: rule.code,
        message: rule.message,
        line: toLineNumber(dot, match.index),
        match: trim(match[0]),
      });
    }
  }

  return violations;
}

export function validateManagedDomainContract({ dotPath = "", dotContent = "" } = {}) {
  const normalizedPath = trim(dotPath);
  let dot = String(dotContent || "");

  if (!dot) {
    if (!normalizedPath) {
      return {
        ok: false,
        code: "missing_dot_path",
        dot_path: "",
        required_output_present: "false",
        produced_keys: [],
        referenced_keys: [],
        shell_context_keys: Array.from(SHELL_CONTEXT_KEYS).sort((a, b) => a.localeCompare(b)),
        violations: [{ code: "missing_dot_path", message: "--dot-path is required." }],
      };
    }

    if (!existsSync(normalizedPath)) {
      return {
        ok: false,
        code: "dot_not_found",
        dot_path: normalizedPath,
        required_output_present: "false",
        produced_keys: [],
        referenced_keys: [],
        shell_context_keys: Array.from(SHELL_CONTEXT_KEYS).sort((a, b) => a.localeCompare(b)),
        violations: [{ code: "dot_not_found", message: `Domain graph not found: ${normalizedPath}` }],
      };
    }

    try {
      dot = loadGraphSemanticsText(normalizedPath);
    } catch (error) {
      return {
        ok: false,
        code: "dot_read_failed",
        dot_path: normalizedPath,
        required_output_present: "false",
        produced_keys: [],
        referenced_keys: [],
        shell_context_keys: Array.from(SHELL_CONTEXT_KEYS).sort((a, b) => a.localeCompare(b)),
        violations: [{ code: "dot_read_failed", message: String(error?.message || error || "dot_read_failed") }],
      };
    }
  }

  const producedEntries = collectProducedKeyEntries(dot);
  const producedKeys = Array.from(new Set(producedEntries.map((entry) => entry.key))).sort((a, b) => a.localeCompare(b));
  const referencedEntries = collectReferencedKeys(dot);
  const referencedKeys = Array.from(new Set(referencedEntries.map((entry) => entry.key))).sort((a, b) => a.localeCompare(b));

  const violations = [];

  if (!producedKeys.includes(REQUIRED_OUTPUT_KEY)) {
    violations.push({
      code: "missing_domain_result_output",
      message: "Domain graph must emit domain_result.",
    });
  }

  for (const entry of producedEntries) {
    if (!FORBIDDEN_OUTPUT_KEYS.has(entry.key)) continue;
    violations.push({
      code: "forbidden_output_key",
      message: `Domain graph must not emit shell-owned key: ${entry.key}`,
      key: entry.key,
      attr: entry.attr,
      line: entry.line,
    });
  }

  for (const entry of collectForbiddenPromptViolations(dot)) {
    violations.push(entry);
  }

  const producedSet = new Set(producedKeys);
  for (const ref of referencedEntries) {
    if (SHELL_CONTEXT_KEYS.has(ref.key) || producedSet.has(ref.key)) continue;
    violations.push({
      code: "unknown_context_key",
      message: `Domain graph references undeclared context key: ${ref.key}`,
      key: ref.key,
      line: ref.line,
    });
  }

  return {
    ok: violations.length === 0,
    code: violations.length === 0 ? "ok" : "managed_domain_contract_violation",
    dot_path: normalizedPath,
    required_output_present: producedKeys.includes(REQUIRED_OUTPUT_KEY) ? "true" : "false",
    produced_keys: producedKeys,
    referenced_keys: referencedKeys,
    shell_context_keys: Array.from(SHELL_CONTEXT_KEYS).sort((a, b) => a.localeCompare(b)),
    violations,
  };
}
