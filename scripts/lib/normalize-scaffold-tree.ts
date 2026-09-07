import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export const SCAFFOLD_SNAPSHOT_SCHEMA = "hatch.scaffolded_factory_snapshot.v1";

export const SCAFFOLD_CONFORMANCE_CONTEXT = Object.freeze({
  factoryId: "scaffolded-test",
  repo: "example-org/scaffolded-test",
  controlPlane: "recallnet/astrochicken",
  runsDir: ".hatch/scaffolded-test/runs",
  trackingIssueUrl: "https://github.com/example-org/scaffolded-test/issues/999",
  trackingIssueNumber: 999,
});

function toPosixPath(pathValue) {
  return String(pathValue).replaceAll("\\", "/");
}

function modeToOctal(mode) {
  return mode.toString(8).padStart(4, "0");
}

export function normalizeScaffoldContent(content, options = {}) {
  const workspaceRoot = options.workspaceRoot ? toPosixPath(resolve(options.workspaceRoot)) : "";
  const trackingIssueUrl = options.trackingIssueUrl ? String(options.trackingIssueUrl) : "";

  let normalized = String(content).replace(/\r\n/g, "\n");
  if (workspaceRoot) {
    normalized = normalized.replaceAll(workspaceRoot, "<WORKSPACE_ROOT>");
  }
  if (trackingIssueUrl) {
    normalized = normalized.replaceAll(trackingIssueUrl, "<TRACKING_ISSUE_URL>");
  }

  normalized = normalized.replace(
    /(https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/)\d+/g,
    "$1<ISSUE_NUMBER>",
  );
  normalized = normalized.replace(/fac_[0-9A-HJKMNP-TV-Z]{10,32}/g, "<FACTORY_INSTANCE_ID>");
  normalized = normalized.replace(/inst_[0-9A-HJKMNP-TV-Z]{10,32}/g, "<FACTORY_INSTALLATION_ID>");

  return normalized;
}

function listFilesRecursively(rootDir) {
  const files = [];
  const stack = [resolve(rootDir)];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      files.push(absolute);
    }
  }

  files.sort((left, right) => left.localeCompare(right, "en"));
  return files;
}

export function snapshotScaffoldTree(options) {
  const factoryRoot = resolve(options.factoryRoot);
  const workspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : undefined;
  const trackingIssueUrl = options.trackingIssueUrl ? String(options.trackingIssueUrl) : "";

  const files = listFilesRecursively(factoryRoot).map((absolutePath) => {
    const stat = statSync(absolutePath);
    return {
      path: toPosixPath(relative(factoryRoot, absolutePath)),
      mode: modeToOctal(stat.mode & 0o777),
      content: normalizeScaffoldContent(readFileSync(absolutePath, "utf8"), {
        workspaceRoot,
        trackingIssueUrl,
      }),
    };
  });

  return {
    schema: SCAFFOLD_SNAPSHOT_SCHEMA,
    generatedFactoryRoot: `factories/${options.factoryId}`,
    files,
  };
}

function toFileMap(snapshot) {
  const map = new Map();
  for (const file of snapshot.files ?? []) {
    map.set(file.path, file);
  }
  return map;
}

export function compareScaffoldSnapshots(expected, actual) {
  const expectedMap = toFileMap(expected);
  const actualMap = toFileMap(actual);

  const addedPaths = [];
  const removedPaths = [];
  const changedFiles = [];

  for (const pathValue of actualMap.keys()) {
    if (!expectedMap.has(pathValue)) {
      addedPaths.push(pathValue);
    }
  }

  for (const pathValue of expectedMap.keys()) {
    if (!actualMap.has(pathValue)) {
      removedPaths.push(pathValue);
      continue;
    }

    const expectedFile = expectedMap.get(pathValue);
    const actualFile = actualMap.get(pathValue);
    const changedFields = [];

    if (expectedFile.mode !== actualFile.mode) {
      changedFields.push("mode");
    }
    if (expectedFile.content !== actualFile.content) {
      changedFields.push("content");
    }

    if (changedFields.length > 0) {
      changedFiles.push({ path: pathValue, changedFields });
    }
  }

  addedPaths.sort((left, right) => left.localeCompare(right, "en"));
  removedPaths.sort((left, right) => left.localeCompare(right, "en"));
  changedFiles.sort((left, right) => left.path.localeCompare(right.path, "en"));

  return {
    ok: addedPaths.length === 0 && removedPaths.length === 0 && changedFiles.length === 0,
    addedPaths,
    removedPaths,
    changedFiles,
    expectedFileCount: expectedMap.size,
    actualFileCount: actualMap.size,
  };
}
