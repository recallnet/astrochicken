import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const FORBIDDEN_PATH_SEGMENTS = [
  "apps/hatch/src/pipeline/handler/",
  "packages/factory-prompts/",
];

const FORBIDDEN_EMITTER_PATTERNS = [
  /canonical-domain-events\.mjs/,
  /\bbuildGoalSelectedEvent\b/,
  /\bbuildIssueCreatedEvent\b/,
  /\bbuildIssueExecutionStartedEvent\b/,
  /\bbuildIssueExecutionCompletedEvent\b/,
  /\bbuildReviewVerdictAppliedEvent\b/,
  /\bbuildMergeCompletedEvent\b/,
  /\bbuildControlActionAppliedEvent\b/,
  /\bdispatchCanonicalDomainEvents\b/,
];

function normalizeRepoRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, path.resolve(targetPath)).split(path.sep).join("/");
}

export function checkCanonicalEventEmitterOwnership({
  repoRoot = process.cwd(),
  files = [],
} = {}) {
  const diagnostics = [];
  for (const file of files) {
    const absolutePath = path.resolve(repoRoot, file);
    const relativePath = normalizeRepoRelative(repoRoot, absolutePath);
    if (!FORBIDDEN_PATH_SEGMENTS.some((segment) => relativePath.startsWith(segment))) {
      continue;
    }
    let source = "";
    try {
      source = readFileSync(absolutePath, "utf8");
    } catch (error) {
      diagnostics.push(`${relativePath}: unreadable (${error?.message || "read_failed"})`);
      continue;
    }
    const matchedPattern = FORBIDDEN_EMITTER_PATTERNS.find((pattern) => pattern.test(source));
    if (matchedPattern) {
      diagnostics.push(`${relativePath}: canonical_event_emitter_forbidden_in_prompt_surface pattern=${matchedPattern}`);
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
  const result = checkCanonicalEventEmitterOwnership({ files });
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) {
      console.error(diagnostic);
    }
    process.exitCode = 1;
  } else {
    console.log(`[canonical_event_emitter_ownership] result=ok checked=${files.length} violations=0`);
  }
}
