function trim(value = "") {
  return String(value || "").trim();
}

function toSnakeCase(value = "") {
  return trim(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function toCodeToken(value = "") {
  const normalized = trim(value);
  return /^[a-z0-9_]+$/.test(normalized) ? normalized : "";
}

export const FACTORY_OPS_ERROR_CODES = Object.freeze({
  missing_args: "missing_args",
  factory_context_resolve_failed: "factory_context_resolve_failed",
  gh_repo_required: "gh_repo_required",
  factory_id_required: "factory_id_required",
  invalid_factory_id: "invalid_factory_id",
  path_collision: "path_collision",
  pid_file_required: "pid_file_required",
  daemon_script_required: "daemon_script_required",
  daemon_script_missing: "daemon_script_missing",
  factory_host_already_running: "factory_host_already_running",
  daemon_spawn_failed: "daemon_spawn_failed",
  factory_host_start_failed: "factory_host_start_failed",
  factory_host_stop_signal_failed: "factory_host_stop_signal_failed",
  factory_host_stop_timeout: "factory_host_stop_timeout",
  factory_host_logs_dir_missing: "factory_host_logs_dir_missing",
  factory_version_unresolved: "factory_version_unresolved",
  lease_record_path_required: "lease_record_path_required",
  lease_record_invalid: "lease_record_invalid",
  lease_record_write_failed: "lease_record_write_failed",
  lease_conflict: "lease_conflict",
  lease_stale: "lease_stale",
  lease_missing: "lease_missing",
  host_assignment_manifest_missing: "host_assignment_manifest_missing",
  host_assignment_manifest_invalid: "host_assignment_manifest_invalid",
  host_assignment_manifest_mismatch: "host_assignment_manifest_mismatch",
  host_assignment_registry_missing: "host_assignment_registry_missing",
  host_assignment_registry_row_missing: "host_assignment_registry_row_missing",
  runtime_version_range_invalid: "runtime_version_range_invalid",
  runtime_incompatible: "runtime_incompatible",
  host_runtime_signature_missing: "host_runtime_signature_missing",
  host_runtime_signature_invalid: "host_runtime_signature_invalid",
  runtime_signature_key_missing: "runtime_signature_key_missing",
  ambiguous_host_assignment: "ambiguous_host_assignment",
  triage_add_label_failed: "triage_add_label_failed",
  triage_blocked_comment_failed: "triage_blocked_comment_failed",
  triage_control_plane_blocker_comment_failed: "triage_control_plane_blocker_comment_failed",
  triage_issue_view_failed: "triage_issue_view_failed",
  triage_rejected_comment_failed: "triage_rejected_comment_failed",
  triage_remove_blocked_label_failed: "triage_remove_blocked_label_failed",
  triage_add_not_planned_label_failed: "triage_add_not_planned_label_failed",
  triage_close_not_planned_failed: "triage_close_not_planned_failed",
});

export const FACTORY_OPS_ERROR_CATALOG = Object.freeze({
  [FACTORY_OPS_ERROR_CODES.factory_context_resolve_failed]: {
    message: "Unable to resolve factory context",
  },
  [FACTORY_OPS_ERROR_CODES.missing_args]: {
    message: "missing_args",
  },
  [FACTORY_OPS_ERROR_CODES.gh_repo_required]: {
    message: "Unable to resolve GitHub repo",
  },
  [FACTORY_OPS_ERROR_CODES.factory_id_required]: {
    message: "factory_id_required",
  },
  [FACTORY_OPS_ERROR_CODES.invalid_factory_id]: {
    message: "invalid_factory_id",
  },
  [FACTORY_OPS_ERROR_CODES.path_collision]: {
    message: "path_collision",
  },
  [FACTORY_OPS_ERROR_CODES.pid_file_required]: {
    message: "pid_file_required",
  },
  [FACTORY_OPS_ERROR_CODES.daemon_script_required]: {
    message: "daemon_script_required",
  },
  [FACTORY_OPS_ERROR_CODES.daemon_script_missing]: {
    message: "daemon_script_not_found",
  },
  [FACTORY_OPS_ERROR_CODES.factory_host_already_running]: {
    message: "factory_host_already_running",
  },
  [FACTORY_OPS_ERROR_CODES.daemon_spawn_failed]: {
    message: "daemon_spawn_failed",
  },
  [FACTORY_OPS_ERROR_CODES.factory_host_start_failed]: {
    message: "factory_host_process_not_running",
  },
  [FACTORY_OPS_ERROR_CODES.factory_host_stop_signal_failed]: {
    message: "factory_host_stop_signal_failed",
  },
  [FACTORY_OPS_ERROR_CODES.factory_host_stop_timeout]: {
    message: "factory_host_stop_timeout",
  },
  [FACTORY_OPS_ERROR_CODES.factory_host_logs_dir_missing]: {
    message: "factory_host_logs_dir_missing",
  },
  [FACTORY_OPS_ERROR_CODES.factory_version_unresolved]: {
    message: "factory_version_unresolved",
  },
  [FACTORY_OPS_ERROR_CODES.lease_record_path_required]: {
    message: "lease_record_path_required",
  },
  [FACTORY_OPS_ERROR_CODES.lease_record_invalid]: {
    message: "lease_record_invalid",
  },
  [FACTORY_OPS_ERROR_CODES.lease_record_write_failed]: {
    message: "lease_record_write_failed",
  },
  [FACTORY_OPS_ERROR_CODES.lease_conflict]: {
    message: "lease_conflict",
  },
  [FACTORY_OPS_ERROR_CODES.lease_stale]: {
    message: "lease_stale",
  },
  [FACTORY_OPS_ERROR_CODES.lease_missing]: {
    message: "lease_missing",
  },
  [FACTORY_OPS_ERROR_CODES.host_assignment_manifest_missing]: {
    message: "host_assignment_manifest_missing",
  },
  [FACTORY_OPS_ERROR_CODES.host_assignment_manifest_invalid]: {
    message: "host_assignment_manifest_invalid",
  },
  [FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch]: {
    message: "host_assignment_manifest_mismatch",
  },
  [FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing]: {
    message: "host_assignment_registry_missing",
  },
  [FACTORY_OPS_ERROR_CODES.host_assignment_registry_row_missing]: {
    message: "host_assignment_registry_row_missing",
  },
  [FACTORY_OPS_ERROR_CODES.runtime_version_range_invalid]: {
    message: "runtime_version_range_invalid",
  },
  [FACTORY_OPS_ERROR_CODES.runtime_incompatible]: {
    message: "runtime_incompatible",
  },
  [FACTORY_OPS_ERROR_CODES.host_runtime_signature_missing]: {
    message: "host_runtime_signature_missing",
  },
  [FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid]: {
    message: "host_runtime_signature_invalid",
  },
  [FACTORY_OPS_ERROR_CODES.runtime_signature_key_missing]: {
    message: "runtime_signature_key_missing",
  },
  [FACTORY_OPS_ERROR_CODES.ambiguous_host_assignment]: {
    message: "ambiguous_host_assignment",
  },
  [FACTORY_OPS_ERROR_CODES.triage_add_label_failed]: {
    message: "triage_add_label_failed",
  },
  [FACTORY_OPS_ERROR_CODES.triage_blocked_comment_failed]: {
    message: "triage_blocked_comment_failed",
  },
  [FACTORY_OPS_ERROR_CODES.triage_control_plane_blocker_comment_failed]: {
    message: "triage_control_plane_blocker_comment_failed",
  },
  [FACTORY_OPS_ERROR_CODES.triage_issue_view_failed]: {
    message: "triage_issue_view_failed",
  },
  [FACTORY_OPS_ERROR_CODES.triage_rejected_comment_failed]: {
    message: "triage_rejected_comment_failed",
  },
  [FACTORY_OPS_ERROR_CODES.triage_remove_blocked_label_failed]: {
    message: "triage_remove_blocked_label_failed",
  },
  [FACTORY_OPS_ERROR_CODES.triage_add_not_planned_label_failed]: {
    message: "triage_add_not_planned_label_failed",
  },
  [FACTORY_OPS_ERROR_CODES.triage_close_not_planned_failed]: {
    message: "triage_close_not_planned_failed",
  },
});

export class FactoryOpsError extends Error {
  constructor(code = "", message = "", { cause = undefined } = {}) {
    const normalizedCode = toCodeToken(code);
    const fallback = FACTORY_OPS_ERROR_CATALOG[normalizedCode]?.message || "factory_ops_error";
    super(trim(message) || fallback);
    this.name = "FactoryOpsError";
    this.code = normalizedCode || "factory_ops_error";
    if (cause !== undefined) this.cause = cause;
  }
}

export function createFactoryOpsError(code = "", message = "", options = {}) {
  return new FactoryOpsError(code, message, options);
}

export function buildFactoryPathNamespaceErrorCode(label = "") {
  const normalizedLabel = toCodeToken(toSnakeCase(label));
  return normalizedLabel ? `${normalizedLabel}_must_include_factory_id` : "";
}

export function buildAmbiguousFactorySubstringErrorCode(label = "") {
  const normalizedLabel = toCodeToken(toSnakeCase(label));
  return normalizedLabel ? `${normalizedLabel}_contains_ambiguous_factory_substring` : "";
}

export function buildHostInstallMissingPathErrorCode(key = "") {
  const normalizedKey = toCodeToken(toSnakeCase(key));
  return normalizedKey ? `host_install_missing_${normalizedKey}` : "";
}

export function extractFactoryOpsErrorCode(errorLike = null) {
  const direct = toCodeToken(errorLike?.error_code || errorLike?.errorCode || errorLike?.code || "");
  if (direct) return direct;

  const message = trim(errorLike?.message || errorLike?.error || errorLike);
  if (!message) return "";

  const match = message.match(/^([a-z0-9_]+)(?::|$)/);
  return match ? toCodeToken(match[1]) : "";
}

export function normalizeFactoryOpsError(errorLike = null, fallbackCode = "factory_ops_error") {
  if (errorLike instanceof FactoryOpsError) {
    return {
      code: errorLike.code,
      message: trim(errorLike.message) || FACTORY_OPS_ERROR_CATALOG[errorLike.code]?.message || fallbackCode,
      rawMessage: trim(errorLike.message),
    };
  }

  const code = extractFactoryOpsErrorCode(errorLike) || toCodeToken(fallbackCode) || "factory_ops_error";
  const rawMessage = trim(errorLike?.message || errorLike?.error || errorLike);
  const catalogMessage = FACTORY_OPS_ERROR_CATALOG[code]?.message || code;

  return {
    code,
    message: rawMessage || catalogMessage,
    rawMessage,
  };
}
