import {
  computeReviewMetrics,
  resolveReviewVerdictsLogPath,
} from "./factory-review-metrics.ts";
import { trim } from "../lib/cli-helpers.ts";
import { buildRemediationPacket } from "../lib/remediation-packet.ts";


export function detectReviewHarnessDegradation({
  factoryId = "",
  runsDir = ".hatch/runs",
  computeReviewMetricsFn = computeReviewMetrics,
  resolveReviewVerdictsLogPathFn = resolveReviewVerdictsLogPath,
} = {}) {
  const normalizedFactoryId = trim(factoryId);
  const normalizedRunsDir = trim(runsDir) || ".hatch/runs";

  let metrics;
  try {
    const verdictsLogPath = resolveReviewVerdictsLogPathFn({
      factoryId: normalizedFactoryId,
      runsDir: normalizedRunsDir,
    });
    metrics = computeReviewMetricsFn({
      verdictsLogPath,
      window: 10,
    });
  } catch {
    return null;
  }

  if (!metrics || Number(metrics.total_issues || 0) < 10) return null;
  if (Number(metrics.force_merge_rate || 0) <= 0.30) return null;

  return {
    problem: "REVIEW_HARNESS_DEGRADATION",
    ownership_decision: "local_fix",
    evidence: {
      force_merge_rate: Number(metrics.force_merge_rate || 0),
      total_reviewed: Number(metrics.total_issues || 0),
      top_reason_codes: Array.isArray(metrics.top_reason_codes) ? metrics.top_reason_codes : [],
    },
    remediation_packet: buildRemediationPacket({
      packetType: "review_harness_degradation",
      intent: "Reduce force-merge churn by improving reviewer and builder instruction quality.",
      inspectionCommands: [
        `hatch-ops factory review-metrics --factory-id '${normalizedFactoryId || "mothership"}' --lookback-hours 24 --json`,
      ],
      executionCommands: [
        "hatch-ops factory review-metrics --lookback-hours 24 --json",
      ],
      verifyCommands: [
        "hatch-ops factory review-metrics --lookback-hours 24 --json",
      ],
      expectedPostconditions: [
        "review harness degradation is explicitly acknowledged with reason-code evidence",
        "supervisor has deterministic commands to inspect retry/force-merge trends",
      ],
      retryPolicy: { max_attempts: 1, on_failure: "defer_with_review_metrics_context", recheck_after: "next_tick" },
    }),
    suggested_action: "hatch-ops factory review-metrics --lookback-hours 24 --json",
  };
}
