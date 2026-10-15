import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function trim(value = "") {
  return String(value || "").trim();
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readJsonFile(path) {
  try {
    return parseJson(readFileSync(path, "utf8"), null);
  } catch {
    return null;
  }
}

function resolveGitCommonDir(path = "") {
  const cwd = trim(path);
  if (!cwd) return "";
  try {
    const out = spawnSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    if (out.status !== 0) return "";
    return trim(out.stdout);
  } catch {
    return "";
  }
}

function listGitWorktreePaths(path = "") {
  const cwd = trim(path);
  if (!cwd) return [];
  try {
    const out = spawnSync("git", ["-C", cwd, "worktree", "list", "--porcelain"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    if (out.status !== 0) return [];
    const lines = String(out.stdout || "").split(/\r?\n/);
    const paths = [];
    for (const line of lines) {
      if (!line.startsWith("worktree ")) continue;
      const worktreePath = trim(line.slice("worktree ".length));
      if (worktreePath) paths.push(worktreePath);
    }
    return paths;
  } catch {
    return [];
  }
}

function resolveControlPlaneRepoName(context = {}) {
  const repo = trim(context?.control_plane_repo);
  if (!repo) return "";
  const parts = repo.split("/");
  return trim(parts[parts.length - 1]);
}

export function normalizePublishedManifest(value = {}) {
  const published = value && typeof value === "object" ? value : {};
  return {
    release_id: trim(published.release_id),
    release_tag: trim(published.release_tag),
    release_sha: trim(published.release_sha),
    asset_id: trim(published.asset_id),
    asset_url: trim(published.asset_url),
    manifest_path: trim(published.manifest_path),
    published_at: trim(published.published_at),
  };
}

export function resolveHatchRootFromRunsDir(runsDir = ".hatch/runs") {
  const normalized = trim(runsDir) || ".hatch/runs";
  const forward = normalized.replace(/\\/g, "/").replace(/\/+$/, "");
  const scoped = forward.match(/^(.*\/\.hatch)(?:\/[^/]+)?\/runs$/);
  if (scoped?.[1]) return scoped[1];
  if (forward.endsWith("/runs")) return dirname(normalized);
  return dirname(normalized) || ".hatch";
}

export function resolveControlPlaneHatchRoot({ runsDir = ".hatch/runs", context = {} } = {}) {
  // 1. Derive from context.factory_root — when the factory root lives inside the
  //    canonical control-plane repo (e.g. <repo>/factories/<name>), walk up to
  //    the repo root and check for .hatch there. Preferred over runsDir because
  //    host-scoped runs dirs sit outside the control-plane repo tree.
  const factoryRoot = trim(context?.factory_root);
  if (factoryRoot) {
    // factory_root is typically <repo>/factories/<factory_id>
    const repoCandidate = dirname(dirname(factoryRoot));
    const hatchFromFactory = join(repoCandidate, ".hatch");
    if (basename(dirname(factoryRoot)) === "factories" && existsSync(hatchFromFactory)) return hatchFromFactory;

    // When status runs from a git worktree, the worktree checkout may not have
    // a local .hatch directory even though the canonical control-plane repo
    // does. Resolve through the shared git common dir before falling back to
    // runsDir so we do not accidentally read the target repo control-state.
    const gitCommonDir = resolveGitCommonDir(factoryRoot);
    if (gitCommonDir) {
      const hatchFromGitCommonDir = join(dirname(gitCommonDir), ".hatch");
      if (existsSync(hatchFromGitCommonDir)) return hatchFromGitCommonDir;
    }

    const controlPlaneRepoName = resolveControlPlaneRepoName(context);
    const worktreePaths = listGitWorktreePaths(factoryRoot)
      .sort((left, right) => {
        const leftBase = basename(left);
        const rightBase = basename(right);
        const leftScore = leftBase === controlPlaneRepoName ? 0 : 1;
        const rightScore = rightBase === controlPlaneRepoName ? 0 : 1;
        if (leftScore !== rightScore) return leftScore - rightScore;
        return left.localeCompare(right);
      });
    for (const worktreePath of worktreePaths) {
      const hatchFromWorktree = join(worktreePath, ".hatch");
      if (existsSync(hatchFromWorktree)) return hatchFromWorktree;
    }
  }

  // 2. runsDir-derived path — hermetic for callers with an explicit runsDir
  //    (unit tests, isolated CLI invocations, and production runs with a resolved runsDir).
  const runsDirDerived = resolveHatchRootFromRunsDir(runsDir);
  if (existsSync(runsDirDerived)) return runsDirDerived;

  // 3. Fall back to FACTORY_CONTEXT_REPO_PATH — process-level override used by
  //    the live daemon when context is not fully populated.
  const envCandidate = trim(process.env.FACTORY_CONTEXT_REPO_PATH);
  if (envCandidate) {
    const hatchRoot = join(envCandidate, ".hatch");
    if (existsSync(hatchRoot)) return hatchRoot;
  }

  return runsDirDerived;
}

export function buildControlPlaneStatus({ runsDir = ".hatch/runs", context = {} } = {}) {
  const hatchRoot = resolveControlPlaneHatchRoot({ runsDir, context });
  const stableManifestReadPath = join(hatchRoot, "releases", "stable", "release-manifest.json");
  const canaryManifestReadPath = join(hatchRoot, "releases", "canary", "release-manifest.json");
  const stableManifestPath = ".hatch/releases/stable/release-manifest.json";
  const canaryManifestPath = ".hatch/releases/canary/release-manifest.json";
  const stableManifest = existsSync(stableManifestReadPath) ? readJsonFile(stableManifestReadPath) : null;
  const canaryManifest = existsSync(canaryManifestReadPath) ? readJsonFile(canaryManifestReadPath) : null;

  const canaryRollout = canaryManifest?.rollout?.controller && typeof canaryManifest.rollout.controller === "object"
    ? canaryManifest.rollout.controller
    : {};
  const canaryRolloutStatus = trim(canaryRollout.status);
  const canaryGateBlocked = canaryRollout.resume_blocked === true
    || canaryRolloutStatus === "canary_in_progress"
    || canaryRolloutStatus === "blocked"
    || canaryRolloutStatus === "rolled_back";

  const selectedChannel = canaryManifest && canaryGateBlocked ? "canary" : "general";
  const selectedManifest = selectedChannel === "canary"
    ? (canaryManifest || stableManifest)
    : (stableManifest || canaryManifest);
  const selectedManifestPath = selectedChannel === "canary"
    ? (canaryManifest ? canaryManifestPath : stableManifestPath)
    : (stableManifest ? stableManifestPath : canaryManifestPath);

  if (!selectedManifest || typeof selectedManifest !== "object") {
    return {
      selected_channel: selectedChannel,
      required_release_floor: "",
      can_resume: false,
      resume_reason: "control_plane_manifest_unavailable",
      resume_when: "Publish or sync a control-plane release manifest.",
      manifest: {
        source: "local_fs",
        path: selectedManifestPath,
        ref: "",
        release_id: "",
        release_tag: "",
        release_sha: "",
      },
      publish: normalizePublishedManifest(),
      rollout: {
        status: "",
        stage: "",
        resume_blocked: false,
        rollback_reason: "",
      },
      control_plane_repo: trim(context?.control_plane_repo),
    };
  }

  const release = selectedManifest?.release && typeof selectedManifest.release === "object" ? selectedManifest.release : {};
  const rollout = selectedManifest?.rollout?.controller && typeof selectedManifest.rollout.controller === "object"
    ? selectedManifest.rollout.controller
    : {};
  const rolloutStatus = trim(rollout.status);
  const resumeBlocked = rollout.resume_blocked === true;
  const rollbackReason = trim(rollout.rollback_reason);
  const requiredReleaseFloor = trim(selectedManifest?.compatibility_matrix?.required_factory_release_floor);

  let resumeReason = "ready_to_resume";
  let canResume = true;
  let resumeWhen = "Release gate already satisfied.";

  if (resumeBlocked || rolloutStatus === "rolled_back" || rolloutStatus === "blocked") {
    resumeReason = "release_rollout_blocked";
    canResume = false;
    resumeWhen = rollbackReason
      ? `Wait for control-plane rollback blocker to clear (${rollbackReason}) and a new manifest publication.`
      : "Wait for control-plane rollout to unblock and publish a new manifest.";
  } else if (rolloutStatus === "canary_in_progress" && selectedChannel === "canary") {
    resumeReason = "release_not_promoted_to_general";
    canResume = false;
    resumeWhen = "Wait for canary health to pass and promotion to stable/general channel.";
  }

  return {
    selected_channel: selectedChannel,
    required_release_floor: requiredReleaseFloor,
    can_resume: canResume,
    resume_reason: resumeReason,
    resume_when: resumeWhen,
    manifest: {
      source: "local_fs",
      path: selectedManifestPath,
      ref: trim(release.tag || release.sha),
      release_id: trim(release.release_id || release.tag || release.sha),
      release_tag: trim(release.tag),
      release_sha: trim(release.sha),
    },
    publish: normalizePublishedManifest(rollout.publish),
    rollout: {
      status: rolloutStatus,
      stage: trim(rollout.stage),
      resume_blocked: resumeBlocked,
      rollback_reason: rollbackReason,
    },
    control_plane_repo: trim(context?.control_plane_repo),
  };
}
