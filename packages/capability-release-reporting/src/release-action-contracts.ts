export const RELEASE_REPORT_CONTEXT_CONTRACT = "release.report_context@v1";
export const RELEASE_NARRATIVE_CONTRACT = "release.narrative@v1";
export const RELEASE_SLACK_PAYLOAD_CONTRACT = "release.slack_payload@v1";
export const RELEASE_DELIVERY_STATUS_CONTRACT = "release.delivery_status@v1";
export const RELEASE_REPORT_ISSUE_DELIVERY_CONTRACT = "release.report_issue_delivery@v1";
export const RELEASE_NARRATIVE_DOCUMENT_DELIVERY_CONTRACT = "release.narrative_document_delivery@v1";
export const RELEASE_EXAMPLE_WEB_FOLLOWUP_DELIVERY_CONTRACT = "release.shaping_followup_delivery@v1";
export const RELEASE_SLACK_DELIVERY_CONTRACT = "release.slack_delivery@v1";
export const RELEASE_DEDUP_CURSOR_UPDATE_CONTRACT = "release.dedup_cursor_update@v1";

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

export function assertReleaseReportContextContract(value: unknown): Record<string, unknown> {
  assertObject(value, RELEASE_REPORT_CONTEXT_CONTRACT);
  if (!String(value.repo || "").trim()) throw new Error(`${RELEASE_REPORT_CONTEXT_CONTRACT} repo is required`);
  if (!String(value.factory_id || "").trim()) throw new Error(`${RELEASE_REPORT_CONTEXT_CONTRACT} factory_id is required`);
  if (!String(value.generated_at || "").trim()) throw new Error(`${RELEASE_REPORT_CONTEXT_CONTRACT} generated_at is required`);
  if (!String(value.since_iso || "").trim()) throw new Error(`${RELEASE_REPORT_CONTEXT_CONTRACT} since_iso is required`);
  assertArray(value.goals, `${RELEASE_REPORT_CONTEXT_CONTRACT} goals`);
  assertArray(value.issues, `${RELEASE_REPORT_CONTEXT_CONTRACT} issues`);
  assertArray(value.prs, `${RELEASE_REPORT_CONTEXT_CONTRACT} prs`);
  assertObject(value.metrics, `${RELEASE_REPORT_CONTEXT_CONTRACT} metrics`);
  assertObject(value.diff_stats, `${RELEASE_REPORT_CONTEXT_CONTRACT} diff_stats`);
  assertObject(value.timing, `${RELEASE_REPORT_CONTEXT_CONTRACT} timing`);
  assertArray(value.errors, `${RELEASE_REPORT_CONTEXT_CONTRACT} errors`);
  return value;
}

export function assertReleaseNarrativeContract(value: unknown): Record<string, unknown> {
  assertObject(value, RELEASE_NARRATIVE_CONTRACT);
  if (!String(value.delivery_decision || "").trim()) throw new Error(`${RELEASE_NARRATIVE_CONTRACT} delivery_decision is required`);
  if ("warnings" in value && !Array.isArray(value.warnings)) throw new Error(`${RELEASE_NARRATIVE_CONTRACT} warnings must be an array when present`);
  return value;
}

export function assertReleaseSlackPayloadContract(value: unknown): Record<string, unknown> {
  assertObject(value, RELEASE_SLACK_PAYLOAD_CONTRACT);
  assertArray(value.blocks, `${RELEASE_SLACK_PAYLOAD_CONTRACT} blocks`);
  return value;
}

interface DeliveryStatus {
  status: string;
  issue_url: string;
}

export function normalizeReleaseDeliveryStatusContract(value: unknown): DeliveryStatus {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return {
      status: String(obj.status || "").trim(),
      issue_url: String(obj.issue_url || "").trim(),
    };
  }
  return {
    status: String(value || "").trim(),
    issue_url: "",
  };
}
