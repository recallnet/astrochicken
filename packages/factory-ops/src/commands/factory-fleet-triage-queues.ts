import {
  FactoryStateReader,
  emptyFleetIncidentProjection,
} from "../lib/factory-state-reader.ts";

function trim(value = "") {
  return String(value ?? "").trim();
}

function nonNegative(value = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function formatDuration(seconds = 0) {
  const total = nonNegative(seconds);
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) return `${hours}h${minutes}m${remain}s`;
  return `${minutes}m${remain}s`;
}

function buildReader({ runsDir = "", context = {} } = {}) {
  return new FactoryStateReader(trim(runsDir) || trim(context?.runs_dir) || ".hatch/runs");
}

export function formatFleetTriageQueues(report = {}) {
  const rows = Array.isArray(report?.queue) ? report.queue : [];
  const lines = [
    `Fleet incident triage generated_at=${trim(report?.generated_at) || "(unknown)"} items=${rows.length}`,
    "queue_type          backlog   owner           tier         affected fingerprint",
  ];

  for (const row of rows) {
    lines.push([
      (trim(row?.queue_type) || "unknown").padEnd(18, " "),
      formatDuration(row?.backlog_age).padStart(8, " "),
      (trim(row?.support_owner) || "unknown").padEnd(14, " "),
      (trim(row?.service_tier) || "unknown").padEnd(12, " "),
      String(Array.isArray(row?.affected_instances) ? row.affected_instances.length : 0).padStart(8, " "),
      trim(row?.fingerprint),
    ].join(" "));
  }

  if (rows.length === 0) {
    lines.push("(no fleet triage queue items)");
  }

  return lines.join("\n");
}

export function factoryFleetTriageQueues({
  context = {},
  runsDir = "",
  lookbackHours = 24,
  now = Date.now(),
  reader = null,
} = {}) {
  try {
    const stateReader = reader || buildReader({ runsDir, context });
    return stateReader.asFleetTriage({
      runsDir: trim(runsDir) || trim(context?.runs_dir) || ".hatch/runs",
      lookbackHours,
      now,
    });
  } catch (error) {
    return {
      ...emptyFleetIncidentProjection({
        nowEpochMs: Number.isFinite(Number(now)) ? Number(now) : Date.now(),
        warnings: ["fleet_triage_projection_failed"],
        ok: false,
        errorCode: "fleet_triage_projection_failed",
      }),
      message: trim(error?.message || error || "fleet_triage_projection_failed"),
    };
  }
}
