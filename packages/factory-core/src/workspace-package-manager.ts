import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

export const ROOT_LOCKFILE = "pnpm-lock.yaml";
export const REQUIRED_BOOTSTRAP_ARTIFACTS: string[][] = [
  ["apps", "hatch", "dist", "cli.js"],
  ["apps", "hatch", "dist", "index.js"],
  ["apps", "hatch", "dist", "pipeline", "handler", "worktree.js"],
];

interface RunResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

interface BootstrapResult {
  ok: boolean;
  reason: string;
  install_code: string;
  build_code: string;
}

interface ArtifactInspectResult {
  ok: boolean;
  diagnostics: string[];
}

function trim(value: string = ""): string {
  return String(value || "").trim();
}

function run(command: string = "", args: string[] = [], { cwd = "", env = process.env }: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: cwd || process.cwd(),
    env,
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    code: Number(result.status ?? 1),
    stdout: trim(result.stdout),
    stderr: trim(result.stderr),
  };
}

export function resolveRootLockfilePath(repoRoot: string = ""): string {
  return path.resolve(trim(repoRoot) || process.cwd(), ROOT_LOCKFILE);
}

function resolvePackageJsonPath(repoRoot: string = ""): string {
  return path.resolve(trim(repoRoot) || process.cwd(), "package.json");
}

export function isBootstrapManagedWorkspace(repoRoot: string = ""): boolean {
  const root = trim(repoRoot) || process.cwd();
  return existsSync(resolveRootLockfilePath(root)) && existsSync(resolvePackageJsonPath(root));
}

export function inspectBootstrapArtifacts(repoRoot: string = "", requiredArtifacts: string[][] = REQUIRED_BOOTSTRAP_ARTIFACTS): ArtifactInspectResult {
  const root = trim(repoRoot) || process.cwd();
  const diagnostics: string[] = [];
  for (const segments of Array.isArray(requiredArtifacts) ? requiredArtifacts : REQUIRED_BOOTSTRAP_ARTIFACTS) {
    const artifactPath = path.resolve(root, ...segments);
    if (!existsSync(artifactPath)) {
      diagnostics.push(`missing:${segments.join("/")}`);
      continue;
    }
    try {
      if (statSync(artifactPath).size <= 0) diagnostics.push(`empty:${segments.join("/")}`);
    } catch {
      diagnostics.push(`unreadable:${segments.join("/")}`);
    }
  }
  return {
    ok: diagnostics.length === 0,
    diagnostics,
  };
}

export function bootstrapWorkspace({
  repoRoot = "",
  workspaceDir = "",
  packageManager = "pnpm",
  requiredArtifacts = REQUIRED_BOOTSTRAP_ARTIFACTS,
  env = process.env,
  runFn = run,
  inspectArtifactsFn = inspectBootstrapArtifacts,
}: {
  repoRoot?: string;
  workspaceDir?: string;
  packageManager?: string;
  requiredArtifacts?: string[][];
  env?: NodeJS.ProcessEnv;
  runFn?: (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => RunResult;
  inspectArtifactsFn?: (root: string, artifacts: string[][]) => ArtifactInspectResult;
} = {}): BootstrapResult {
  const root = trim(repoRoot) || process.cwd();
  const workdir = trim(workspaceDir) || root;
  if (!isBootstrapManagedWorkspace(root)) {
    return {
      ok: true,
      reason: "bootstrap_not_required",
      install_code: "",
      build_code: "",
    };
  }
  const bootstrapEnv = {
    ...env,
    CI: trim(env?.CI) || "true",
  };
  const install = runFn(packageManager, ["install", "--frozen-lockfile"], {
    cwd: workdir,
    env: bootstrapEnv,
  });
  if (!install.ok) {
    return {
      ok: false,
      reason: install.stderr || install.stdout || "pnpm_install_failed",
      install_code: String(install.code),
      build_code: "",
    };
  }
  const build = runFn(packageManager, ["--silent", "build"], {
    cwd: workdir,
    env: bootstrapEnv,
  });
  if (!build.ok) {
    return {
      ok: false,
      reason: build.stderr || build.stdout || "pnpm_build_failed",
      install_code: String(install.code),
      build_code: String(build.code),
    };
  }
  const enforceArtifacts = Array.isArray(requiredArtifacts) ? requiredArtifacts.length > 0 : true;
  const artifacts = enforceArtifacts
    ? inspectArtifactsFn(root, requiredArtifacts)
    : { ok: true, diagnostics: [] };
  if (!artifacts.ok) {
    const repair = runFn(packageManager, ["--filter", "hatch", "build"], {
      cwd: workdir,
      env: bootstrapEnv,
    });
    if (!repair.ok) {
      return {
        ok: false,
        reason: repair.stderr || repair.stdout || artifacts.diagnostics.join(",") || "workspace_artifact_repair_failed",
        install_code: String(install.code),
        build_code: String(repair.code),
      };
    }
    const repairedArtifacts = inspectArtifactsFn(root, requiredArtifacts);
    if (!repairedArtifacts.ok) {
      return {
        ok: false,
        reason: repairedArtifacts.diagnostics.join(",") || "workspace_artifacts_missing_after_repair",
        install_code: String(install.code),
        build_code: String(repair.code),
      };
    }
  }
  return {
    ok: true,
    reason: "workspace_bootstrapped",
    install_code: String(install.code),
    build_code: String(build.code),
  };
}

export function repairWorkspaceBootstrap({
  repoRoot = "",
  workspaceDir = "",
  packageManager = "pnpm",
  requiredArtifacts = REQUIRED_BOOTSTRAP_ARTIFACTS,
  env = process.env,
  runFn = run,
  inspectArtifactsFn = inspectBootstrapArtifacts,
}: {
  repoRoot?: string;
  workspaceDir?: string;
  packageManager?: string;
  requiredArtifacts?: string[][];
  env?: NodeJS.ProcessEnv;
  runFn?: (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => RunResult;
  inspectArtifactsFn?: (root: string, artifacts: string[][]) => ArtifactInspectResult;
} = {}): BootstrapResult {
  const root = trim(repoRoot) || process.cwd();
  const workdir = trim(workspaceDir) || root;
  if (!isBootstrapManagedWorkspace(root)) {
    return {
      ok: true,
      reason: "bootstrap_not_required",
      install_code: "",
      build_code: "",
    };
  }

  const bootstrapEnv = {
    ...env,
    CI: trim(env?.CI) || "true",
  };

  const bootstrapScriptPath = path.resolve(root, "scripts", "postinstall-bootstrap.mjs");
  if (existsSync(bootstrapScriptPath)) {
    // @context:regression !critical Daemon restarts on an unchanged lockfile
    // must repair the checked-in workspace link layer without re-running a full
    // pnpm install, or concurrent factory startups can tear down shared
    // node_modules state under the control-plane checkout.
    const bootstrap = runFn(process.execPath, [bootstrapScriptPath], {
      cwd: workdir,
      env: bootstrapEnv,
    });
    if (!bootstrap.ok) {
      return {
        ok: false,
        reason: bootstrap.stderr || bootstrap.stdout || "workspace_bootstrap_script_failed",
        install_code: String(bootstrap.code),
        build_code: "",
      };
    }
  }

  const enforceArtifacts = Array.isArray(requiredArtifacts) ? requiredArtifacts.length > 0 : true;
  const artifacts = enforceArtifacts
    ? inspectArtifactsFn(root, requiredArtifacts)
    : { ok: true, diagnostics: [] };
  if (!artifacts.ok) {
    const repair = runFn(packageManager, ["--filter", "hatch", "build"], {
      cwd: workdir,
      env: bootstrapEnv,
    });
    if (!repair.ok) {
      return {
        ok: false,
        reason: repair.stderr || repair.stdout || artifacts.diagnostics.join(",") || "workspace_artifact_repair_failed",
        install_code: "0",
        build_code: String(repair.code),
      };
    }
    const repairedArtifacts = inspectArtifactsFn(root, requiredArtifacts);
    if (!repairedArtifacts.ok) {
      return {
        ok: false,
        reason: repairedArtifacts.diagnostics.join(",") || "workspace_artifacts_missing_after_repair",
        install_code: "0",
        build_code: String(repair.code),
      };
    }
  }

  return {
    ok: true,
    reason: "workspace_bootstrapped",
    install_code: "0",
    build_code: "0",
  };
}
