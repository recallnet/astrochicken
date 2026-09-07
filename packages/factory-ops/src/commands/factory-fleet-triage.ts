import { asFleetTriageQueues } from "../lib/factory-state-reader.ts";

const QUEUE_KEYS = Object.freeze([
  "platform_incidents",
  "local_instance_incidents",
  "blocked_instances",
  "repeated_failure_risk",
  "upgrade_drift",
  "host_capacity_pressure",
]);

function trim(value = "") {
  return String(value ?? "").trim();
}

function nonNegative(value = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeArray(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => trim(entry))
    .filter(Boolean);
}

function formatSeconds(value = 0) {
  const total = nonNegative(value);
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
  return `${minutes}m${seconds}s`;
}

function normalizePriorityScore(item = {}) {
  const score = Number(item?.ranking?.priority_score);
  if (!Number.isFinite(score)) return 0;
  return Number(score.toFixed(2));
}

function normalizeRank(item = {}) {
  const rank = Number(item?.ranking?.rank);
  if (!Number.isFinite(rank) || rank <= 0) return 0;
  return Math.floor(rank);
}

function resolveAffectedInstances(item = {}) {
  const direct = normalizeArray(item?.affected_instances);
  if (direct.length > 0) return direct;
  const instanceId = trim(item?.instance_id || item?.factory_id);
  return instanceId ? [instanceId] : [];
}

function resolveSupportOwner(item = {}) {
  return trim(item?.support_owner || item?.blast_radius?.support_owner || "ops");
}

function resolveServiceTier(item = {}) {
  return trim(item?.service_tier || item?.blast_radius?.service_tier || "standard");
}

function compareRows(left = {}, right = {}) {
  if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.queueType !== right.queueType) return left.queueType.localeCompare(right.queueType);
  return left.fingerprint.localeCompare(right.fingerprint);
}

function truncate(value = "", max = 44) {
  const text = trim(value);
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function formatFleetQueueRow({ queueType = "", item = {} } = {}) {
  const affectedInstances = resolveAffectedInstances(item);
  const blockedDuration = nonNegative(item?.blocked_duration_seconds);
  const backlogAge = Math.max(
    nonNegative(item?.backlog_age_seconds),
    nonNegative(item?.oldest_work_age_seconds),
  );

  return {
    queueType: trim(queueType),
    fingerprint: trim(item?.fingerprint),
    rank: normalizeRank(item),
    priorityScore: normalizePriorityScore(item),
    blockedDuration,
    backlogAge,
    supportOwner: resolveSupportOwner(item),
    serviceTier: resolveServiceTier(item),
    affectedInstances,
    affectedInstanceCount: nonNegative(item?.blast_radius?.affected_instance_count) || affectedInstances.length,
    queueReasons: normalizeArray(item?.queue_reasons),
    severity: trim(item?.severity || "warning"),
  };
}

export function formatBlastRadius({ queueType = "platform_incidents", item = {} } = {}) {
  const queueRow = formatFleetQueueRow({ queueType, item });
  return {
    queueType: queueRow.queueType,
    fingerprint: queueRow.fingerprint,
    rank: queueRow.rank,
    priorityScore: queueRow.priorityScore,
    supportOwner: queueRow.supportOwner,
    serviceTier: queueRow.serviceTier,
    affectedInstances: queueRow.affectedInstances,
    affectedInstanceCount: queueRow.affectedInstanceCount,
    servicesImpacted: normalizeArray(item?.blast_radius?.services_impacted),
    queueReasons: queueRow.queueReasons,
    severity: queueRow.severity,
  };
}

export function buildFleetTriageQueuesView({ projection = {} } = {}) {
  const rows = [];
  for (const queueType of QUEUE_KEYS) {
    const items = Array.isArray(projection?.[queueType]) ? projection[queueType] : [];
    for (const item of items) {
      rows.push(formatFleetQueueRow({ queueType, item }));
    }
  }

  rows.sort(compareRows);

  return {
    schemaVersion: trim(projection?.schema_version),
    generatedAt: trim(projection?.generated_at),
    queueMetadata: projection?.queue_metadata && typeof projection.queue_metadata === "object"
      ? projection.queue_metadata
      : {},
    items: rows,
  };
}

export function buildFleetTriageBlastRadiusView({ projection = {}, fingerprint = "" } = {}) {
  const normalizedFingerprint = trim(fingerprint);
  if (!normalizedFingerprint) {
    return {
      ok: false,
      error_code: "fingerprint_required",
      message: "fingerprint_required",
      fingerprint: "",
    };
  }

  const platformRows = Array.isArray(projection?.platform_incidents) ? projection.platform_incidents : [];
  const matched = platformRows.find((item) => trim(item?.fingerprint) === normalizedFingerprint);
  if (!matched) {
    return {
      ok: false,
      error_code: "invalid_fingerprint",
      message: `fingerprint_not_found:${normalizedFingerprint}`,
      fingerprint: normalizedFingerprint,
    };
  }

  return {
    ok: true,
    schemaVersion: trim(projection?.schema_version),
    generatedAt: trim(projection?.generated_at),
    blastRadius: formatBlastRadius({ queueType: "platform_incidents", item: matched }),
  };
}

export async function runFleetTriageQueues({
  context = {},
  registryPath = "factory-registry.json",
  mirrorDir = "",
  hostBaseDir = "",
  hostRepoRoot = process.cwd(),
  eventLimit = 200,
  now = Date.now(),
  loadProjectionFn = asFleetTriageQueues,
} = {}) {
  const projection = await loadProjectionFn({
    context,
    registryPath,
    mirrorDir,
    hostBaseDir,
    hostRepoRoot,
    eventLimit,
    now,
  });

  return buildFleetTriageQueuesView({ projection });
}

export async function runFleetTriageBlastRadius({
  context = {},
  registryPath = "factory-registry.json",
  mirrorDir = "",
  hostBaseDir = "",
  hostRepoRoot = process.cwd(),
  eventLimit = 200,
  now = Date.now(),
  fingerprint = "",
  loadProjectionFn = asFleetTriageQueues,
} = {}) {
  const normalizedFingerprint = trim(fingerprint);
  if (!normalizedFingerprint) {
    return {
      ok: false,
      error_code: "fingerprint_required",
      message: "fingerprint_required",
      fingerprint: "",
    };
  }

  const projection = await loadProjectionFn({
    context,
    registryPath,
    mirrorDir,
    hostBaseDir,
    hostRepoRoot,
    eventLimit,
    now,
  });

  return buildFleetTriageBlastRadiusView({
    projection,
    fingerprint: normalizedFingerprint,
  });
}

export function formatFleetTriageQueuesHuman(report = {}) {
  const rows = Array.isArray(report?.items) ? report.items : [];
  const lines = [
    `Fleet triage queues generated_at=${trim(report?.generatedAt) || "(unknown)"} items=${rows.length}`,
    "rank queue                     priority blocked  backlog  owner             tier       affected fingerprint",
  ];

  for (const row of rows) {
    lines.push([
      String(row.rank || 0).padStart(4, " "),
      (row.queueType || "").padEnd(25, " "),
      String((Number(row.priorityScore) || 0).toFixed(2)).padStart(8, " "),
      formatSeconds(row.blockedDuration).padStart(8, " "),
      formatSeconds(row.backlogAge).padStart(8, " "),
      truncate(row.supportOwner || "ops", 16).padEnd(16, " "),
      truncate(row.serviceTier || "standard", 10).padEnd(10, " "),
      String(row.affectedInstanceCount || row.affectedInstances?.length || 0).padStart(8, " "),
      truncate(row.fingerprint || "", 44),
    ].join(" "));
  }

  if (rows.length === 0) {
    lines.push("(no fleet triage queue items)");
  }

  return lines.join("\n");
}

export function formatFleetTriageBlastRadiusHuman(payload = {}) {
  const blast = payload?.blastRadius || {};
  const lines = [
    `Fleet triage blast radius fingerprint=${trim(blast.fingerprint) || "(unknown)"}`,
    `  queue      : ${trim(blast.queueType) || "platform_incidents"}`,
    `  rank/score : #${nonNegative(blast.rank)} / ${(Number(blast.priorityScore) || 0).toFixed(2)}`,
    `  routing    : owner=${trim(blast.supportOwner) || "ops"} tier=${trim(blast.serviceTier) || "standard"}`,
    `  affected   : count=${nonNegative(blast.affectedInstanceCount)} instances=${(Array.isArray(blast.affectedInstances) ? blast.affectedInstances.join(",") : "") || "none"}`,
    `  services   : ${(Array.isArray(blast.servicesImpacted) ? blast.servicesImpacted.join(",") : "") || "none"}`,
    `  severity   : ${trim(blast.severity) || "warning"}`,
    `  reasons    : ${(Array.isArray(blast.queueReasons) ? blast.queueReasons.join(" | ") : "") || "none"}`,
  ];

  return lines.join("\n");
}
