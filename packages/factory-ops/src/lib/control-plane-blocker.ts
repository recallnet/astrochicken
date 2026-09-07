const CONTROL_PLANE_BLOCKER_SCHEMA = "control_plane_blocker.v1";

const VALID_KINDS = new Set(["upstream_bug", "release_floor", "upstream_rejected"]);
const VALID_STATUS = new Set(["blocked", "resumed", "rejected", "superseded"]);

function emptyBlocker() {
  return {
    kind: "",
    blockerRef: "",
    unblockCondition: "",
    status: "",
    releaseId: "",
    releaseTag: "",
    releaseSha: "",
    manifestPath: "",
  };
}

function normalizeKind(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VALID_KINDS.has(normalized) ? normalized : "";
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VALID_STATUS.has(normalized) ? normalized : "";
}

function normalizeBlocker(input = {}) {
  const blocker = input && typeof input === "object" ? input : {};
  return {
    kind: normalizeKind(blocker.kind ?? blocker.blockerKind ?? blocker.blocker_kind),
    blockerRef: String(blocker.blockerRef ?? blocker.blocker_ref ?? "").trim(),
    unblockCondition: String(blocker.unblockCondition ?? blocker.unblock_condition ?? "").trim(),
    status: normalizeStatus(blocker.status),
    releaseId: String(blocker.releaseId ?? blocker.release_id ?? "").trim(),
    releaseTag: String(blocker.releaseTag ?? blocker.release_tag ?? "").trim(),
    releaseSha: String(blocker.releaseSha ?? blocker.release_sha ?? "").trim(),
    manifestPath: String(blocker.manifestPath ?? blocker.manifest_path ?? "").trim(),
  };
}

function parseJson(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function extractLabels(metadata = {}) {
  if (!metadata || typeof metadata !== "object") return [];
  const labels = Array.isArray(metadata.labels) ? metadata.labels : [];
  return labels
    .map((label) => String(label?.name || label?.get?.("name") || label || "").trim().toLowerCase())
    .filter(Boolean);
}

function extractMetadataStrings(metadata) {
  const out = [];

  const add = (value) => {
    if (typeof value === "string" && value.trim()) out.push(value.trim());
  };

  const visit = (value) => {
    if (!value) return;
    if (typeof value === "string") {
      add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === "object") {
      add(value.body);
      add(value.note);
      add(value.notes);
      add(value.comment);
      add(value.metadata);
      add(value.unblockCondition);
      add(value.unblock_condition);
      if (Array.isArray(value.comments)) {
        for (const comment of value.comments) {
          add(comment?.body || comment);
        }
      }
    }
  };

  visit(metadata);
  return out;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSerializedBlocker(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return null;

  const prefixed = text.match(new RegExp(`${escapeRegExp(CONTROL_PLANE_BLOCKER_SCHEMA)}\\s*:?\\s*(\\{[\\s\\S]*\\})`, "i"));
  if (prefixed?.[1]) {
    const parsed = parseJson(prefixed[1], null);
    if (parsed && typeof parsed === "object") return normalizeBlocker(parsed);
  }

  if (text.startsWith("{") && text.endsWith("}")) {
    const parsed = parseJson(text, null);
    if (parsed && typeof parsed === "object") return normalizeBlocker(parsed);
  }

  return null;
}

function mergeBlocker(base, incoming) {
  const next = { ...base };
  if (incoming.kind) next.kind = incoming.kind;
  if (incoming.blockerRef) next.blockerRef = incoming.blockerRef;
  if (incoming.unblockCondition) next.unblockCondition = incoming.unblockCondition;
  if (incoming.status) next.status = incoming.status;
  if (incoming.releaseId) next.releaseId = incoming.releaseId;
  if (incoming.releaseTag) next.releaseTag = incoming.releaseTag;
  if (incoming.releaseSha) next.releaseSha = incoming.releaseSha;
  if (incoming.manifestPath) next.manifestPath = incoming.manifestPath;
  return next;
}

function applyDefaults(blocker = emptyBlocker()) {
  const out = { ...blocker };
  if (out.status === "blocked" && !out.kind) out.kind = "upstream_bug";
  if (!out.unblockCondition) {
    if (out.kind === "release_floor" && out.blockerRef) {
      out.unblockCondition = `Install or publish release floor ${out.blockerRef}.`;
    } else if (out.kind === "upstream_bug" && out.blockerRef) {
      out.unblockCondition = `Wait for upstream bug ${out.blockerRef} to close.`;
    } else if (out.status === "blocked") {
      out.unblockCondition = "Wait for control-plane blocker status to change.";
    }
  }
  return out;
}

export function parseControlPlaneBlocker(metadata) {
  let blocker = emptyBlocker();
  let sawSignal = false;

  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const direct = normalizeBlocker(metadata);
    if (
      direct.kind
      || direct.status
      || direct.blockerRef
      || direct.unblockCondition
      || direct.releaseId
      || direct.releaseTag
      || direct.releaseSha
      || direct.manifestPath
    ) {
      blocker = mergeBlocker(blocker, direct);
      sawSignal = true;
    }
  }

  const labels = extractLabels(metadata);
  if (labels.includes("blocked-control-plane") || labels.includes("blocked_control_plane")) {
    blocker = mergeBlocker(blocker, { status: "blocked" });
    sawSignal = true;
  }

  for (const raw of extractMetadataStrings(metadata)) {
    const serialized = parseSerializedBlocker(raw);
    if (serialized) {
      blocker = mergeBlocker(blocker, serialized);
      sawSignal = true;
    }
  }

  const normalized = applyDefaults(blocker);
  if (
    !sawSignal
    && !normalized.kind
    && !normalized.status
    && !normalized.blockerRef
    && !normalized.unblockCondition
    && !normalized.releaseId
    && !normalized.releaseTag
    && !normalized.releaseSha
    && !normalized.manifestPath
  ) {
    return emptyBlocker();
  }
  return normalized;
}

export function serializeControlPlaneBlocker(blocker) {
  const normalized = applyDefaults(normalizeBlocker(blocker));
  if (
    !normalized.kind
    && !normalized.status
    && !normalized.blockerRef
    && !normalized.unblockCondition
    && !normalized.releaseId
    && !normalized.releaseTag
    && !normalized.releaseSha
    && !normalized.manifestPath
  ) return "";

  const payload = {
    kind: normalized.kind,
    blockerRef: normalized.blockerRef,
    unblockCondition: normalized.unblockCondition,
    status: normalized.status,
  };

  if (normalized.releaseId) payload.release_id = normalized.releaseId;
  if (normalized.releaseTag) payload.release_tag = normalized.releaseTag;
  if (normalized.releaseSha) payload.release_sha = normalized.releaseSha;
  if (normalized.manifestPath) payload.manifest_path = normalized.manifestPath;

  return `${CONTROL_PLANE_BLOCKER_SCHEMA}:${JSON.stringify(payload)}`;
}

export function isControlPlaneBlocked(blocker) {
  const normalized = applyDefaults(normalizeBlocker(blocker));
  return normalized.status === "blocked";
}

export function isControlPlaneResolved(blocker) {
  const normalized = normalizeBlocker(blocker);
  return normalized.status === "resumed" || normalized.status === "rejected" || normalized.status === "superseded";
}

export function describeUnblockCondition(blocker) {
  const normalized = applyDefaults(normalizeBlocker(blocker));
  if (normalized.unblockCondition) return normalized.unblockCondition;
  if (normalized.status === "rejected") return "Upstream rejected the requested control-plane change.";
  if (normalized.status === "superseded") return "Upstream superseded this blocker with a replacement path.";
  if (normalized.status === "resumed") return "Control-plane blocker resolved; dispatch may resume.";
  return "";
}

export function buildStructuredUnblockCondition({
  kind = "",
  blockerRef = "",
  requiredReleaseFloor = "",
  linkedGoalNumber = "",
} = {}) {
  const issueNum = linkedGoalNumber
    ? String(linkedGoalNumber)
    : extractBlockerRefIssueNumber({ blockerRef: String(blockerRef || "") });

  const normalized = parseControlPlaneBlocker({
    kind: String(kind || ""),
    blockerRef: String(blockerRef || ""),
    unblockCondition: String(requiredReleaseFloor || ""),
  });

  return {
    kind: String(normalized.kind || ""),
    blockerRef: String(normalized.blockerRef || ""),
    required_release_floor: String(requiredReleaseFloor || ""),
    linked_goal_number: issueNum ? Number(issueNum) : 0,
    human_text: describeUnblockCondition(normalized),
  };
}

export function extractBlockerRefIssueNumber(blocker) {
  const ref = String(blocker?.blockerRef || "").trim();
  if (!ref) return "";
  const m = ref.match(/^#?(\d+)$/);
  return m ? m[1] : "";
}

export {
  CONTROL_PLANE_BLOCKER_SCHEMA,
};
