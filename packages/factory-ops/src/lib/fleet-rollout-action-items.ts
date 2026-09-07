import { trim } from "./cli-helpers.ts";

export function buildFleetRolloutActionItems({ report = {}, repo = "", controlPlaneRepo = "" } = {}) {
  const rows = Array.isArray(report?.factories) ? report.factories : [];
  const resolvedRepo = trim(repo);
  const resolvedControlPlaneRepo = trim(controlPlaneRepo);
  const actionItems = [];

  for (const row of rows) {
    const status = trim(row?.rollout_status);
    if (status !== "blocked" && status !== "lagging") continue;

    const factoryId = trim(row?.factory_id) || "unknown";
    const requiredFactoryRelease = trim(row?.required_factory_release);
    const gateReason = trim(row?.gate_reason) || "state_unknown";
    const statusDetail = trim(row?.status_detail) || gateReason;
    const itemType = status === "blocked" ? "fleet_rollout_blocked" : "fleet_rollout_lagging";

    actionItems.push({
      type: itemType,
      factory_id: factoryId,
      gate_reason: gateReason,
      status_detail: statusDetail,
      reason: gateReason,
      message: statusDetail,
      required_factory_release: requiredFactoryRelease,
      problem: `FLEET_ROLLOUT_${status.toUpperCase()}: factory ${factoryId} status=${status} reason=${gateReason}`,
      suggested_action: [
        `hatch-ops factory release-targeting-status --registry-path <registry-path> --policy-path <policy-path> --manifest-fetch-cmd '<cmd>' --json`,
        resolvedRepo ? `# repo=${resolvedRepo}` : "# repo=<target-repo>",
        resolvedControlPlaneRepo ? `# control_plane_repo=${resolvedControlPlaneRepo}` : "# control_plane_repo=<control-plane-repo>",
        "# then apply upgrade or unblock",
      ].join(" "),
    });
  }

  return actionItems;
}
