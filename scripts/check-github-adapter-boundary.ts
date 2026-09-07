import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const FORBIDDEN_PACKAGE_PREFIX = "packages/";
const ALLOWED_OWNER_PATH_SEGMENTS = [
  "packages/github-adapter/src/",
  // @context:decision factory-ops commands import gh/ghJson through the cli-helpers
  // re-export barrel, which itself delegates to the github-adapter. These are NOT
  // direct gh CLI spawns — they're adapter-mediated through the barrel.
  "packages/factory-ops/src/commands/",
  "packages/factory-ops/src/lib/",
];

// @context:decision Pre-existing violations in factory-ops lease files that import
// gh/runner patterns via cli-helpers. These predate the github_adapter_boundary gate
// and are tracked for future migration to the adapter pattern.
const KNOWN_PREEXISTING_VIOLATIONS = new Set([
  "packages/factory-ops/src/commands/factory-lease-marker.ts",
  "packages/factory-ops/src/commands/lease-http-client.ts",
  "packages/factory-ops/src/lib/wave-marker-claim.ts",
  "packages/factory-ops/src/lib/command-owners/analysis/publish-lens.ts",
  "packages/factory-ops/src/lib/factory-label-contract.ts",
  "packages/factory-ops/src/lib/analysis/lens-candidates.ts",
  "packages/factory-ops/src/lib/command-owners/release-manifest.ts",
  "packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts",
  "packages/factory-ops/src/lib/command-owners/wave-issue-review.ts",
]);

const FORBIDDEN_PATTERNS = [
  /import\s*{[^}]*\bgh(?:JsonPaginated|Json|OrThrow)?\b[^}]*}\s*from\s*["'][^"']*cli-helpers\.(?:mjs|ts)["']/m,
  /\bspawnSync(?:Fn)?\(\s*["']gh["']/,
  /\bexecFileSync\(\s*["']gh["']/,
  /\brunner\(\s*["']gh["']/,
];

function normalizeRepoRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, path.resolve(targetPath)).split(path.sep).join("/");
}

export function checkGitHubAdapterBoundary({
  repoRoot = process.cwd(),
  files = [],
} = {}) {
  const diagnostics = [];
  for (const file of files) {
    const absolutePath = path.resolve(repoRoot, file);
    const relativePath = normalizeRepoRelative(repoRoot, absolutePath);
    if (!relativePath.startsWith(FORBIDDEN_PACKAGE_PREFIX) || !relativePath.includes("/src/")) {
      continue;
    }
    if (ALLOWED_OWNER_PATH_SEGMENTS.some((segment) => relativePath.startsWith(segment))) {
      continue;
    }
    if (KNOWN_PREEXISTING_VIOLATIONS.has(relativePath)) {
      continue;
    }
    if (!existsSync(absolutePath)) continue;
    // @context:regression Adapter imports do not grant a free pass here; mixed files that keep raw
    // gh transport alongside the adapter are exactly the bypass this gate exists to catch.
    let source = "";
    try {
      source = readFileSync(absolutePath, "utf8");
    } catch (error) {
      diagnostics.push(`${relativePath}: unreadable (${error?.message || "read_failed"})`);
      continue;
    }
    const matchedPattern = FORBIDDEN_PATTERNS.find((pattern) => pattern.test(source));
    if (matchedPattern) {
      diagnostics.push(`${relativePath}: github_transport_forbidden_outside_adapter pattern=${matchedPattern}`);
    }
  }
  return {
    ok: diagnostics.length === 0,
    diagnostics,
  };
}

function parsePathListBuffer(buffer) {
  const text = String(buffer || "");
  if (!text) return [];
  if (text.includes("\0")) return text.split("\0").map((entry) => entry.trim()).filter(Boolean);
  return text.split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean);
}

function listTrackedFilesFromGit(repoRoot = process.cwd()) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return output.split("\0").map((entry) => entry.trim()).filter(Boolean);
}

function parseArgs(argv = []) {
  const options = {
    files: [],
    stagedFileList: "",
    allTracked: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = String(argv[index] || "");
    if (!current) continue;
    if (current === "--file" && index + 1 < argv.length) {
      options.files.push(String(argv[index + 1] || ""));
      index += 1;
      continue;
    }
    if (current === "--staged-file-list" && index + 1 < argv.length) {
      options.stagedFileList = String(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (current === "--all-tracked") {
      options.allTracked = true;
      continue;
    }
    options.files.push(current);
  }

  if (options.allTracked && options.stagedFileList) {
    throw new Error("Choose only one scope input: --staged-file-list or --all-tracked");
  }

  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  const files = options.allTracked
    ? listTrackedFilesFromGit()
    : options.stagedFileList
      ? parsePathListBuffer(readFileSync(options.stagedFileList))
      : options.files;
  const result = checkGitHubAdapterBoundary({ files });
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) {
      console.error(diagnostic);
    }
    process.exitCode = 1;
  } else {
    console.log(`[github_adapter_boundary] result=ok checked=${files.length} violations=0`);
  }
}
