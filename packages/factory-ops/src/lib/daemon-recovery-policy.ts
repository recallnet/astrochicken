function trim(value = "") {
  return String(value || "").trim();
}

export function shouldSkipRecoverySweepWorktreeScan(runtime = {}) {
  const workspaceMode = trim(runtime?.config?.workspace_mode);
  return workspaceMode === "api_only" || workspaceMode === "checkout";
}
