import { trim } from "../lib/cli-helpers.ts";

const CONTROL_PLANE_PATTERNS = [
  /control[_ -]?plane/i,
  /upstream/i,
  /managed[_ -]?factory[_ -]?bug/i,
  /external[_ -]?factory/i,
  /open_upstream_bugs_malformed_payload/i,
  /gh_issue_list_failed/i,
];

const LOCAL_PATTERNS = [
  /local/i,
  /domain[_ -]?graph/i,
  /intake/i,
  /action[_ -]?item/i,
  /kind_missing_domain_graph/i,
  /instance_kind_mismatch/i,
  /kind_id_mismatch/i,
  /invalid_json:.*kind\.json/i,
  /invalid_json:.*instance\.json/i,
  /missing_file:.*kind\.json/i,
  /missing_file:.*instance\.json/i,
];

export function classifyManagedFailure({ domainError = "", parseError = "", gate = "" } = {}) {
  const errors = [trim(domainError), trim(parseError)].filter(Boolean);
  // gate alone is an operational state (e.g. "run"), not a failure signal.
  // Only include it in the classification input when there's an actual error.
  if (errors.length > 0 && trim(gate)) errors.push(trim(gate));
  const combined = errors.join("\n");

  if (!combined) {
    return {
      failure_classification: "none",
      failure_reason: "",
    };
  }

  if (CONTROL_PLANE_PATTERNS.some((pattern) => pattern.test(combined))) {
    return {
      failure_classification: "infrastructure",
      failure_reason: combined,
    };
  }

  if (LOCAL_PATTERNS.some((pattern) => pattern.test(combined))) {
    return {
      failure_classification: "local",
      failure_reason: combined,
    };
  }

  return {
    failure_classification: "ambiguous",
    failure_reason: combined,
  };
}
