import { trim, gh } from "../lib/cli-helpers.ts";
import { FACTORY_OPS_ERROR_CODES } from "../lib/error-catalog.ts";
import {
  FACTORY_LABEL_KEYS,
  buildIssueLabelEditArgs,
} from "../lib/factory-label-contract.ts";


export function applyTriageDuplicate({
  repo,
  issueNumber,
  duplicateOf = "",
  ghExec = gh,
} = {}) {
  const issue = String(issueNumber || "").trim();
  const duplicate = String(duplicateOf || "").trim();
  if (!repo || !issue) return { ok: false, error: FACTORY_OPS_ERROR_CODES.missing_args, error_code: FACTORY_OPS_ERROR_CODES.missing_args };

  const steps = [];
  if (duplicate && duplicate !== "0") {
    steps.push(ghExec([
      "issue", "comment", issue, "--repo", repo, "--body", `Duplicate of #${duplicate}. Closing.`,
    ]));
  }
  steps.push(ghExec([
    "issue", "close", issue, "--repo", repo, "--reason", "not_planned",
  ]));

  return {
    ok: steps.every((step) => step.ok),
    steps: steps.map((step) => step.status),
  };
}

export function applyTriageDeferred({
  repo,
  issueNumber,
  notes = "",
  ghExec = gh,
} = {}) {
  const issue = String(issueNumber || "").trim();
  const note = String(notes || "").trim();
  if (!repo || !issue) return { ok: false, error: FACTORY_OPS_ERROR_CODES.missing_args, error_code: FACTORY_OPS_ERROR_CODES.missing_args };

  const steps = [
    ghExec(buildIssueLabelEditArgs({
      repo,
      issueNumber: issue,
      factoryId: "mothership",
      addKeys: [FACTORY_LABEL_KEYS.TRIAGED, FACTORY_LABEL_KEYS.DEFERRED],
    })),
  ];
  if (note) {
    steps.push(ghExec([
      "issue", "comment", issue, "--repo", repo, "--body", `Deferred during triage: ${note}`,
    ]));
  }

  return {
    ok: steps.every((step) => step.ok),
    steps: steps.map((step) => step.status),
  };
}
