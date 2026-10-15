import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import { createReleaseIssueReader } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";

import { mkdirSync, writeFileSync, chmodSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";


import { RELEASE_MANIFEST_SCHEMA_VERSION, CONTROL_PLANE_RELEASE_STATUSES, buildReleaseManifest, resolveReleaseManifestPath, produceReleaseManifest, collectReleaseManifestEntries, validateReleaseManifestContract, parseReleaseManifestPayload, markArtifactInManifest } from "../../src/commands/release-manifest.ts";

function makeGhMock(dir, fixturePath) {
  const ghPath = join(dir, "gh");
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
import { readFileSync } from "node:fs";

const fixturePath = process.env.RELEASE_MANIFEST_FIXTURE;
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const args = process.argv.slice(2);

function listIssues(repo, state) {
  const rows = fixture.issue_list?.[repo]?.[state] || [];
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "list") {
  const repo = args[args.indexOf("--repo") + 1];
  const state = args[args.indexOf("--state") + 1];
  listIssues(repo, state);
}

if (args[0] === "issue" && args[1] === "view") {
  const issueNumber = String(args[2]);
  const repo = args[args.indexOf("--repo") + 1];
  const payload = fixture.issue_view?.[repo]?.[issueNumber] || { number: Number(issueNumber), comments: [], url: "" };
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

process.stdout.write("[]");
`,
    "utf8",
  );
  chmodSync(ghPath, 0o755);
  process.env.RELEASE_MANIFEST_FIXTURE = fixturePath;
}

function sampleEntries() {
  return [
    {
      source_repo: "example/external-factory",
      source_issue: 17,
      summary: "Add external adapter",
      factory_id: "external/issue_worker",
      required_factory_release: "1.4.0",
      status: "blocked_upstream",
      signature_hash: "sha256:aaa",
      linkage: {
        schema_version: "factory_link.v1",
        linkage_key: "sha256:one",
        control_plane_repo: "recallnet/astrochicken",
        control_plane_goal: 900,
        source_repo: "example/external-factory",
        source_issue: 17,
        status: "blocked_upstream",
        factory_id: "external/issue_worker",
        required_factory_release: "1.4.0",
        signature_hash: "sha256:aaa",
      },
    },
    {
      source_repo: "example/external-factory",
      source_issue: 18,
      summary: "Fix runner panic",
      factory_id: "external/issue_worker",
      required_factory_release: "1.5.0",
      status: "blocked_upstream",
      signature_hash: "sha256:bbb",
      linkage: {
        schema_version: "factory_link.v1",
        linkage_key: "sha256:two",
        control_plane_repo: "recallnet/astrochicken",
        control_plane_goal: 901,
        source_repo: "example/external-factory",
        source_issue: 18,
        status: "blocked_upstream",
        factory_id: "external/issue_worker",
        required_factory_release: "1.5.0",
        signature_hash: "sha256:bbb",
      },
    },
  ];
}

test("buildReleaseManifest emits deterministic compatibility floor and schema", () => {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseSha: "abc123",
    releaseTag: "v1.5.0",
    changelogSummary: "release notes",
    entries: sampleEntries(),
  });

  assert.equal(manifest.schema_version, RELEASE_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.release.sha, "abc123");
  assert.equal(manifest.release.tag, "v1.5.0");
  assert.equal(manifest.release.release_id, "v1.5.0");
  assert.equal(manifest.rollout.schema_version, "release_rollout_state/v1");
  assert.equal(manifest.rollout.controller.status, "pending");
  assert.equal(manifest.compatibility_matrix.mode, "strict_version_floor");
  assert.equal(manifest.compatibility_matrix.required_factory_release_floor, "1.5.0");
  assert.deepEqual(manifest.compatibility_matrix.required_factory_releases, ["1.4.0", "1.5.0"]);
  assert.equal(manifest.artifacts[0].linkage.fixed_in_version, "");
  assert.equal(manifest.artifacts[0].linkage.fixed_in_manifest, "");
});

test("buildReleaseManifest fails closed when release identity is missing", () => {
  assert.throws(
    () => buildReleaseManifest({
      controlPlaneRepo: "recallnet/astrochicken",
      releaseSha: "",
      releaseTag: "",
      entries: sampleEntries(),
    }),
    /missing_release_identity/,
  );
});

test("release manifest schema validator accepts v1 payload and parse helper is stable", () => {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseSha: "abc123",
    releaseTag: "v1.5.0",
    entries: sampleEntries(),
  });

  const validation = validateReleaseManifestContract(manifest);
  assert.equal(validation.ok, true);
  assert.equal(validation.reasons.length, 0);

  const parsed = parseReleaseManifestPayload(JSON.stringify(manifest));
  assert.equal(parsed?.schema_version, RELEASE_MANIFEST_SCHEMA_VERSION);
  assert.equal(parsed?.artifacts?.length, 2);
});

test("release manifest status contract accepts canonical statuses and fails closed on unknown values", () => {
  const statuses = [
    "fixed_main_unreleased",
    "fixed_released",
    "rejected",
    "superseded",
    "blocked_upstream",
  ];
  assert.deepEqual(CONTROL_PLANE_RELEASE_STATUSES, statuses);

  for (const status of statuses) {
    const manifest = buildReleaseManifest({
      controlPlaneRepo: "recallnet/astrochicken",
      releaseSha: "abc123",
      releaseTag: "v1.5.0",
      entries: [{
        ...sampleEntries()[0],
        status,
      }],
    });
    assert.equal(manifest.artifacts[0].status, status);
    assert.equal(validateReleaseManifestContract(manifest).ok, true);
  }

  assert.throws(
    () => buildReleaseManifest({
      controlPlaneRepo: "recallnet/astrochicken",
      releaseSha: "abc123",
      releaseTag: "v1.5.0",
      entries: [{
        ...sampleEntries()[0],
        status: "blocked_on_goal",
      }],
    }),
    /invalid_artifact_status:0/,
  );
});

test("release manifest schema validator fails closed on missing release identity", () => {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseSha: "abc123",
    releaseTag: "v1.5.0",
    entries: sampleEntries(),
  });

  manifest.release.sha = "";
  manifest.release.tag = "";

  const validation = validateReleaseManifestContract(manifest);
  assert.equal(validation.ok, false);
  assert.match(validation.reasons.join(","), /missing_release_identity/);
  assert.equal(parseReleaseManifestPayload(manifest), null);
});

test("markArtifactInManifest annotates linkage with fixed-in release and manifest path", () => {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseSha: "abc123",
    releaseTag: "v1.5.0",
    entries: sampleEntries(),
  });

  const out = markArtifactInManifest(
    manifest.artifacts[0],
    { release_id: "v1.5.0", release_tag: "v1.5.0", release_sha: "abc123" },
    ".hatch/releases/v1.5.0/release-manifest.json",
  );

  assert.equal(out.changed, true);
  assert.equal(out.already_recorded, false);
  assert.equal(out.entry.linkage.fixed_in_version, "v1.5.0");
  assert.equal(out.entry.linkage.fixed_in_manifest, ".hatch/releases/v1.5.0/release-manifest.json");

  const second = markArtifactInManifest(
    out.entry,
    { release_id: "v1.5.0", release_tag: "v1.5.0", release_sha: "abc123" },
    ".hatch/releases/v1.5.0/release-manifest.json",
  );
  assert.equal(second.changed, false);
  assert.equal(second.already_recorded, true);
});

test("release manifest schema validator emits deterministic status reason on invalid artifact status", () => {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseSha: "abc123",
    releaseTag: "v1.5.0",
    entries: sampleEntries(),
  });

  manifest.artifacts[0].status = "blocked_on_goal";

  const validation = validateReleaseManifestContract(manifest);
  assert.equal(validation.ok, false);
  assert.match(validation.reasons.join(","), /invalid_artifact_status:0/);
  assert.equal(parseReleaseManifestPayload(manifest), null);
});

test("release manifest schema validator fails closed on linkage drift", () => {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseSha: "abc123",
    releaseTag: "v1.5.0",
    entries: sampleEntries(),
  });

  manifest.artifacts[0].linkage.schema_version = "factory_link.v2";

  const validation = validateReleaseManifestContract(manifest);
  assert.equal(validation.ok, false);
  assert.match(validation.reasons.join(","), /invalid_artifact_linkage_schema:0/);
  assert.equal(parseReleaseManifestPayload(manifest), null);
});

test("resolveReleaseManifestPath chooses deterministic run/release locations", () => {
  const runPath = resolveReleaseManifestPath({ runId: "run-1", runsDir: ".hatch/runs" });
  assert.equal(runPath, join(".hatch/runs", "run-1", "artifacts", "release-manifest.json"));

  const releasePath = resolveReleaseManifestPath({ releaseTag: "v1.2.3", releasesDir: ".hatch/releases" });
  assert.equal(releasePath, join(".hatch/releases", "v1.2.3", "release-manifest.json"));
});

test("produceReleaseManifest reuses sanitized ingest metadata and linkage payload", () => {
  const temp = mkdtempSync(join(tmpdir(), "release-manifest-"));
  const fixturePath = join(temp, "fixture.json");

  const artifactPayload = {
    schema_version: "artifact.v1",
    factory_id: "external/issue_worker",
    source_repo: "example/external-factory",
    run_id: "run-777",
    kind: "blocker",
    artifact_type: "blocker",
    summary: "Token ghp_abcdefghijklmnopqrstuvwxyz123456 leaked in /Users/alice/private/path",
    evidence_excerpt: "bearer abcdef",
    required_factory_release: "1.7.0",
  };

  const linkagePayload = {
    schema_version: "factory_link.v1",
    source_repo: "example/external-factory",
    source_issue: 77,
    control_plane_repo: "recallnet/astrochicken",
    control_plane_goal: 1201,
    signature_hash: "sha256:from-link",
    factory_id: "external/issue_worker",
    required_factory_release: "1.7.0",
    status: "blocked_upstream",
  };

  const fixture = {
    issue_list: {
      "example/external-factory": {
        closed: [
          {
            number: 77,
            title: "[artifact] external worker",
            state: "CLOSED",
            url: "https://github.com/example/external-factory/issues/77",
            body: `Machine-generated\n\n\
\`\`\`json\n${JSON.stringify(artifactPayload, null, 2)}\n\`\`\``,
          },
        ],
      },
    },
    issue_view: {
      "example/external-factory": {
        "77": {
          number: 77,
          url: "https://github.com/example/external-factory/issues/77",
          comments: [
            {
              body: `Artifact linked\n\n\
\`\`\`json\n${JSON.stringify(linkagePayload, null, 2)}\n\`\`\``,
            },
          ],
        },
      },
    },
  };

  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), "utf8");

  const binDir = join(temp, "bin");
  mkdirSync(binDir, { recursive: true });
  makeGhMock(binDir, fixturePath);

  const previousPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${previousPath}`;

  try {
    const out = produceReleaseManifest({
      controlPlaneRepo: "recallnet/astrochicken",
      sourceRepos: ["example/external-factory"],
      states: "closed",
      runId: "run-777",
      releaseSha: "deadbeef",
      releaseTag: "v1.7.1",
      runsDir: join(temp, "runs"),
      releasesDir: join(temp, "releases"),
    });

    assert.equal(out.ok, true);
    assert.equal(out.schema_version, RELEASE_MANIFEST_SCHEMA_VERSION);
    assert.equal(out.artifact_count, 1);
    assert.equal(out.required_factory_release_floor, "1.7.0");
    assert.equal(existsSync(out.manifest_path), true);

    const written = JSON.parse(readFileSync(out.manifest_path, "utf8"));
    assert.equal(written.schema_version, RELEASE_MANIFEST_SCHEMA_VERSION);
    assert.equal(written.artifacts[0].required_factory_release, "1.7.0");
    assert.equal(written.artifacts[0].status, "blocked_upstream");
    assert.equal(written.artifacts[0].linkage.control_plane_goal, 1201);
    assert.match(written.artifacts[0].summary, /\[REDACTED_TOKEN\]/);
    assert.match(written.artifacts[0].summary, /\[REDACTED_PATH\]/);
    assert.match(written.changelog_summary, /\[REDACTED_TOKEN\]/);
  } finally {
    process.env.PATH = previousPath;
    delete process.env.RELEASE_MANIFEST_FIXTURE;
  }
});

test("collectReleaseManifestEntries filters by run id and carries resume gate metadata", () => {
  const fixture = {
    issue_list: {
      "example/external-factory": {
        closed: [
          {
            number: 21,
            title: "artifact one",
            state: "CLOSED",
            url: "https://example/21",
            body: `\`\`\`json\n${JSON.stringify({
              schema_version: "artifact.v1",
              factory_id: "external/issue_worker",
              source_repo: "example/external-factory",
              run_id: "target-run",
              summary: "one",
              required_factory_release: "1.0.0",
            }, null, 2)}\n\`\`\``,
          },
          {
            number: 22,
            title: "artifact two",
            state: "CLOSED",
            url: "https://example/22",
            body: `\`\`\`json\n${JSON.stringify({
              schema_version: "artifact.v1",
              factory_id: "external/issue_worker",
              source_repo: "example/external-factory",
              run_id: "other-run",
              summary: "two",
              required_factory_release: "2.0.0",
            }, null, 2)}\n\`\`\``,
          },
        ],
      },
    },
    issue_view: {
      "example/external-factory": {
        "21": {
          number: 21,
          url: "https://example/21",
          comments: [
            {
              body: `\`\`\`json\n${JSON.stringify({
                schema_version: "factory_link.v1",
                source_repo: "example/external-factory",
                source_issue: 21,
                control_plane_repo: "recallnet/astrochicken",
                control_plane_goal: 333,
                signature_hash: "sha256:sig21",
                factory_id: "external/issue_worker",
                required_factory_release: "1.0.0",
                status: "blocked_upstream",
              }, null, 2)}\n\`\`\``,
            },
          ],
        },
      },
    },
  };

  const ghJsonFn = createReleaseIssueReader(fixture);

  const entries = collectReleaseManifestEntries({
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepos: ["example/external-factory"],
    states: "closed",
    runId: "target-run",
    localFactoryRelease: "1.1.0",
    ghJsonFn,
    checkResumeGateFn: () => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 333, state: "CLOSED", url: "https://example/goal/333", title: "Goal" },
      local_factory_release: "1.1.0",
      required_factory_release: "1.0.0",
    }),
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].source_issue, 21);
  assert.equal(entries[0].resume_gate.reason, "ready_to_resume");
  assert.equal(entries[0].resume_gate.required_factory_release, "1.0.0");
});

test("produceReleaseManifest fails closed when upstream artifact status is outside allowlist", () => {
  const fixture = {
    issue_list: {
      "example/external-factory": {
        closed: [
          {
            number: 71,
            title: "artifact invalid status",
            state: "CLOSED",
            url: "https://example/71",
            body: `\`\`\`json\n${JSON.stringify({
              schema_version: "artifact.v1",
              factory_id: "external/issue_worker",
              source_repo: "example/external-factory",
              run_id: "run-invalid-status",
              summary: "artifact",
              required_factory_release: "1.0.0",
              status: "blocked_on_goal",
            }, null, 2)}\n\`\`\``,
          },
        ],
      },
    },
    issue_view: {
      "example/external-factory": {
        "71": {
          number: 71,
          url: "https://example/71",
          comments: [
            {
              body: `\`\`\`json\n${JSON.stringify({
                schema_version: "factory_link.v1",
                source_repo: "example/external-factory",
                source_issue: 71,
                control_plane_repo: "recallnet/astrochicken",
                control_plane_goal: 333,
                signature_hash: "sha256:sig71",
                factory_id: "external/issue_worker",
                required_factory_release: "1.0.0",
                status: "blocked_upstream",
              }, null, 2)}\n\`\`\``,
            },
          ],
        },
      },
    },
  };

  const ghJsonFn = createReleaseIssueReader(fixture);

  assert.throws(
    () => produceReleaseManifest({
      controlPlaneRepo: "recallnet/astrochicken",
      sourceRepos: ["example/external-factory"],
      states: "closed",
      runId: "run-invalid-status",
      releaseSha: "abc123",
      releaseTag: "v1.0.0",
      ghJsonFn,
    }),
    /invalid_artifact_status:0/,
  );
});

test("artifact release-manifest CLI emits manifest metadata", () => {
  const temp = mkdtempSync(join(tmpdir(), "release-manifest-cli-"));
  const fixturePath = join(temp, "fixture.json");

  const artifactPayload = {
    schema_version: "artifact.v1",
    factory_id: "mothership/factory_supervisor",
    source_repo: "recallnet/astrochicken",
    run_id: "run-cli",
    kind: "blocker",
    artifact_type: "blocker",
    summary: "CLI release manifest path",
    required_factory_release: "2.0.0",
  };

  const linkagePayload = {
    schema_version: "factory_link.v1",
    source_repo: "recallnet/astrochicken",
    source_issue: 88,
    control_plane_repo: "recallnet/astrochicken",
    control_plane_goal: 2040,
    signature_hash: "sha256:manifest-cli",
    factory_id: "mothership/factory_supervisor",
    required_factory_release: "2.0.0",
    status: "blocked_upstream",
  };

  const fixture = {
    issue_list: {
      "recallnet/astrochicken": {
        closed: [
          {
            number: 88,
            title: "[artifact] intents",
            state: "CLOSED",
            url: "https://github.com/recallnet/astrochicken/issues/88",
            body: `\`\`\`json\n${JSON.stringify(artifactPayload, null, 2)}\n\`\`\``,
          },
        ],
      },
    },
    issue_view: {
      "recallnet/astrochicken": {
        "88": {
          number: 88,
          url: "https://github.com/recallnet/astrochicken/issues/88",
          comments: [
            {
              body: `\`\`\`json\n${JSON.stringify(linkagePayload, null, 2)}\n\`\`\``,
            },
          ],
        },
      },
    },
  };

  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), "utf8");
  const binDir = join(temp, "bin");
  mkdirSync(binDir, { recursive: true });
  makeGhMock(binDir, fixturePath);

  const prevPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${prevPath}`;

  try {
    const run = spawnOpsCli([
      "artifact",
      "release-manifest",
      "--control-plane-repo",
      "recallnet/astrochicken",
      "--source-repos",
      "recallnet/astrochicken",
      "--states",
      "closed",
      "--run-id",
      "run-cli",
      "--release-sha",
      "abc123",
      "--release-tag",
      "v2.0.1",
      "--runs-dir",
      join(temp, "runs"),
      "--releases-dir",
      join(temp, "releases")
    ]);

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(run.stdout || "{}");
    assert.equal(out.ok, true);
    assert.equal(out.schema_version, RELEASE_MANIFEST_SCHEMA_VERSION);
    assert.equal(out.release_tag, "v2.0.1");
    assert.equal(out.artifact_count, 1);
    assert.equal(out.required_factory_release_floor, "2.0.0");
  } finally {
    process.env.PATH = prevPath;
    delete process.env.RELEASE_MANIFEST_FIXTURE;
  }
});

test("produceReleaseManifest fails closed when release identity is missing", () => {
  assert.throws(
    () => produceReleaseManifest({
      controlPlaneRepo: "recallnet/astrochicken",
      sourceRepos: ["example/external-factory"],
      states: "closed",
      releaseSha: "",
      releaseTag: "",
      ghJsonFn: () => {
        throw new Error("should_not_be_called");
      },
    }),
    /missing_release_identity/,
  );
});

test("produceReleaseManifest fails closed on GH issue list failure", () => {
  const ghJsonFn = (args, fallback = []) => {
    if (args[0] === "issue" && args[1] === "list") {
      throw new Error("gh_command_failed: issue list denied");
    }
    return fallback;
  };

  assert.throws(
    () => produceReleaseManifest({
      controlPlaneRepo: "recallnet/astrochicken",
      sourceRepos: ["example/external-factory"],
      states: "closed",
      releaseSha: "abc123",
      releaseTag: "v1.0.0",
      ghJsonFn,
    }),
    /gh_command_failed: issue list denied/,
  );
});

test("produceReleaseManifest fails closed when linkage comment is missing", () => {
  const fixture = {
    issue_list: {
      "example/external-factory": {
        closed: [
          {
            number: 55,
            title: "artifact no linkage",
            state: "CLOSED",
            url: "https://example/55",
            body: `\`\`\`json\n${JSON.stringify({
              schema_version: "artifact.v1",
              factory_id: "external/issue_worker",
              source_repo: "example/external-factory",
              run_id: "run-no-link",
              summary: "artifact",
              required_factory_release: "1.0.0",
            }, null, 2)}\n\`\`\``,
          },
        ],
      },
    },
    issue_view: {
      "example/external-factory": {
        "55": {
          number: 55,
          url: "https://example/55",
          comments: [],
        },
      },
    },
  };

  const ghJsonFn = createReleaseIssueReader(fixture);

  assert.throws(
    () => produceReleaseManifest({
      controlPlaneRepo: "recallnet/astrochicken",
      sourceRepos: ["example/external-factory"],
      states: "closed",
      runId: "run-no-link",
      releaseSha: "abc123",
      releaseTag: "v1.0.0",
      ghJsonFn,
    }),
    /missing_linkage_record: example\/external-factory#55/,
  );
});
