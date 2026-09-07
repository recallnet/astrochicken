import { parseJson, trim } from "../lib/cli-helpers.ts";

/**
 * Required fields for a final brainstorm report.
 * If the agent output is valid JSON containing all of these with non-empty values,
 * the brainstorm is done.
 */
const FINAL_REPORT_FIELDS = ["proposal", "success_criteria", "scope_in", "scope_out"];

function extractJson(raw = "") {
  const trimmed = trim(raw);
  if (!trimmed) return null;

  // Try direct parse first
  const direct = parseJson(trimmed, null);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;

  // Try extracting from markdown fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    const fenced = parseJson(trim(fenceMatch[1]), null);
    if (fenced && typeof fenced === "object" && !Array.isArray(fenced)) return fenced;
  }

  // Try extracting JSON object from preamble text (find first { to last })
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    const extracted = parseJson(candidate, null);
    if (extracted && typeof extracted === "object" && !Array.isArray(extracted)) return extracted;
  }

  return null;
}

function isFinalReport(parsed) {
  if (!parsed) return false;

  // Agents signal convergence via terminate: true. Without it, a matching
  // shape is just a conversational round, not the final report.
  const terminate = parsed.terminate;
  if (terminate !== true && terminate !== "true") return false;

  for (const field of FINAL_REPORT_FIELDS) {
    const val = parsed[field];
    if (val == null) return false;
    if (Array.isArray(val) && val.length === 0) return false;
    if (typeof val === "string" && !trim(val)) return false;
  }
  return true;
}

// @context:decision The `terminate:true` non-final case must set should_force_wrap but NOT
// is_final, so existing graph routing (which gates on is_final) keeps working. Downstream
// routing additions in #2565 will consume should_force_wrap to take the early-exit path.
// !critical: Do not merge these two signals — is_final drives close_issue; should_force_wrap
// drives force_wrap. Conflating them would cause premature issue closure.
export function checkBrainstormOutput({ agentOutput = "", source = "unknown" } = {}) {
  const raw = String(agentOutput ?? "");
  const isEmpty = !raw.trim();

  const parsed = extractJson(raw);
  const final = isFinalReport(parsed);

  if (final) {
    return {
      is_final: "true",
      source,
      final_report: JSON.stringify(parsed),
      conversational_output: "",
      should_force_wrap: "false",
      termination_reason: "",
      is_empty_output: "false",
    };
  }

  // Terminate signal present but report shape invalid — deterministic early-exit signal.
  if (parsed) {
    const terminate = parsed.terminate;
    if (terminate === true || terminate === "true") {
      return {
        is_final: "false",
        source,
        final_report: "",
        conversational_output: raw,
        should_force_wrap: "true",
        termination_reason: "terminate_signal_non_final",
        is_empty_output: "false",
      };
    }
  }

  // Empty or whitespace output.
  if (isEmpty) {
    return {
      is_final: "false",
      source,
      final_report: "",
      conversational_output: raw,
      should_force_wrap: "false",
      termination_reason: "",
      is_empty_output: "true",
    };
  }

  // Normal conversational output.
  return {
    is_final: "false",
    source,
    final_report: "",
    conversational_output: raw,
    should_force_wrap: "false",
    termination_reason: "",
    is_empty_output: "false",
  };
}
