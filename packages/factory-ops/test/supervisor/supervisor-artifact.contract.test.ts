import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SUPERVISOR_ARTIFACT_OWNER_PATH = "packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts";

test("emitBugIssue must exist and search both open AND closed for dedup", () => {
  const src = readFileSync(SUPERVISOR_ARTIFACT_OWNER_PATH, "utf8");
  assert.ok(src.includes("export function emitBugIssue"), "emitBugIssue must be exported");
  assert.ok(
    src.includes('"--state", "all"') || src.includes("--state", "all"),
    "emitBugIssue must search --state all to prevent create→close→create loops"
  );
});

test("emitSupervisorArtifact carries classification into signature and payload", () => {
  const src = readFileSync(SUPERVISOR_ARTIFACT_OWNER_PATH, "utf8");
  assert.ok(src.includes("classification = \"\""), "emitSupervisorArtifact must accept classification");
  assert.ok(src.includes("classification: normalizedClassification"), "OTEL payload must include classification");
  assert.ok(src.includes("classification: String(classification || \"\")"), "artifact body must include classification");
  assert.ok(src.includes("sigFor({ artifactType, classification: normalizedClassification, summary, evidence })"), "signature must include classification for deterministic dedup");
});

test("emitBugIssue includes title-level dedup for wave-judge-failure", () => {
  const src = readFileSync(SUPERVISOR_ARTIFACT_OWNER_PATH, "utf8");
  assert.ok(src.includes('bugType === "wave-judge-failure"'), "must apply title-level dedup for wave-judge-failure");
});

test("emitBugIssue suppresses reopen for closed-source wave give-up bugs", () => {
  const src = readFileSync(SUPERVISOR_ARTIFACT_OWNER_PATH, "utf8");
  assert.ok(src.includes("wave-issue-giveup-"), "must detect wave give-up bug types");
  assert.ok(src.includes('"issue", "view"') || src.includes("issue\", \"view"), "must inspect source issue state before reopening");
  assert.ok(src.includes("suppressed_reopen_source_issue_closed"), "must return deterministic suppression reason");
});

test("emitBugIssue supports incident.v2 metadata overrides from callers", () => {
  const src = readFileSync(SUPERVISOR_ARTIFACT_OWNER_PATH, "utf8");
  assert.ok(src.includes("classification = \"\""), "emitBugIssue must accept classification override");
  assert.ok(src.includes("severity = \"\""), "emitBugIssue must accept severity override");
  assert.ok(src.includes("crashType = \"\""), "emitBugIssue must accept crashType override");
  assert.ok(src.includes("runtimeVersion = \"\""), "emitBugIssue must accept runtimeVersion override");
  assert.ok(src.includes("kindVersion = \"\""), "emitBugIssue must accept kindVersion override");
  assert.ok(src.includes("fingerprint = \"\""), "emitBugIssue must accept explicit fingerprint override");
  assert.ok(src.includes("needsReviewQueuePath = \"\""), "emitBugIssue must accept needs-review queue path override");
});

test("emitBugIssue appends structured evidence when reopening", () => {
  const src = readFileSync(SUPERVISOR_ARTIFACT_OWNER_PATH, "utf8");
  assert.ok(src.includes("buildReopenComment"), "emitBugIssue reopen path must build structured evidence comment");
  assert.ok(src.includes("buildReopenComment({"), "reopen path must call buildReopenComment with structured payload");
  assert.ok(src.includes('"comment"'), "reopen path must post a comment with reopening evidence");
});

test("emitBugIssue retains signature marker and incident fingerprint marker for dedup", () => {
  const src = readFileSync(SUPERVISOR_ARTIFACT_OWNER_PATH, "utf8");
  assert.ok(src.includes("Bug-Signature"), "signature marker must remain for backward-compatible dedup");
  assert.ok(src.includes("Incident-Fingerprint:"), "incident fingerprint marker must be emitted");
  assert.ok(src.includes("extractIncidentFingerprintFromIssueBody"), "fingerprint parser must be present for dedup lookup");
});

test("emitBugIssue creates issues with bug+goal+ready labels", () => {
  const src = readFileSync(SUPERVISOR_ARTIFACT_OWNER_PATH, "utf8");
  const bugFnStart = src.indexOf("export function emitBugIssue");
  assert.ok(bugFnStart >= 0, "emitBugIssue must exist");
  const bugFn = src.slice(bugFnStart);
  assert.ok(bugFn.includes("resolveBugLabels"), "emitBugIssue must resolve label set before create/reopen");
  assert.ok(bugFn.includes("labels = []"), "emitBugIssue must accept extra labels input");
  assert.ok(src.includes("[BUG_LABEL, GOAL_LABEL, READY_LABEL"),
    "default bug labels must include bug, goal, and ready through the shared label contract");
});

test("emitBugIssue body includes Incident Packet JSON section and uses packet builder", () => {
  const src = readFileSync(SUPERVISOR_ARTIFACT_OWNER_PATH, "utf8");
  const packetSrc = readFileSync("packages/factory-ops/src/lib/incident-packet.ts", "utf8");
  const fingerprintSrc = readFileSync("packages/factory-ops/src/lib/incident-fingerprint.ts", "utf8");
  assert.ok(src.includes("## Incident Packet"), "bug issue body must include an Incident Packet section");
  assert.ok(src.includes("JSON.stringify(incidentPacket, null, 2)"), "Incident Packet section must serialize packet JSON");
  assert.ok(src.includes("buildIncidentPacket({"), "emitBugIssue must build the packet before filing");
  assert.ok(src.includes("classifySupervisorFailure({"), "emitBugIssue must classify incidents deterministically before filing");
  assert.ok(src.includes("deriveIncidentSeverity({"), "emitBugIssue must derive severity deterministically");
  assert.ok(packetSrc.includes("schema: \"incident.v2\""), "Incident Packet schema must include incident.v2");
  assert.ok(packetSrc.includes("fingerprint"), "Incident Packet schema must include fingerprint key");
  assert.ok(fingerprintSrc.includes("createIncidentFingerprint"), "incident fingerprint helper must exist");
});

test("supervisor emit-bug CLI command routes through emitBugIssue with incident.v2 args", () => {
  const src = readFileSync("packages/factory-ops/src/cli/commands/supervisor.ts", "utf8");
  assert.ok(src.includes("class SupervisorEmitBugCommand"), "supervisor emit-bug command must exist");
  assert.ok(src.includes("static paths = [[\"supervisor\", \"emit-bug\"]]"), "command must register supervisor emit-bug path");
  assert.ok(src.includes("emitBugIssue({"), "command must call emitBugIssue for bug emission");
  assert.ok(src.includes("labels = Option.Array(\"--label\", [])"), "command must accept repeatable --label flags");
  assert.ok(src.includes("labelsAlias = Option.Array(\"--labels\", [])"), "command must accept --labels alias used by supervisor rubric");
  assert.ok(src.includes("labels: parsedLabels"), "command must pass parsed label list through to emitBugIssue");
  assert.ok(src.includes("classification: this.classification"), "command must pass classification through to emitBugIssue");
  assert.ok(src.includes("severity: this.severity"), "command must pass severity through to emitBugIssue");
  assert.ok(src.includes("crashType: this.crashType"), "command must pass crashType through to emitBugIssue");
  assert.ok(src.includes("runtimeVersion: this.runtimeVersion"), "command must pass runtimeVersion through to emitBugIssue");
  assert.ok(src.includes("kindVersion: this.kindVersion"), "command must pass kindVersion through to emitBugIssue");
  assert.ok(src.includes("kindId: this.kindId"), "command must pass kindId through to emitBugIssue");
  assert.ok(src.includes("instanceId: this.instanceId"), "command must pass instanceId through to emitBugIssue");
  assert.ok(src.includes("hostId: this.hostId"), "command must pass hostId through to emitBugIssue");
  assert.ok(src.includes("fingerprint: this.fingerprint"), "command must pass fingerprint through to emitBugIssue");
  assert.ok(src.includes("needsReviewQueuePath: this.needsReviewQueuePath"), "command must pass needs-review queue path through to emitBugIssue");
});

test("emitBugIssue example-trading managed defaults include managed-factory labels", () => {
  const src = readFileSync(SUPERVISOR_ARTIFACT_OWNER_PATH, "utf8");
  assert.ok(src.includes("shouldApplyReplayLabManagedLabels"), "helper must exist for example-trading managed label defaults");
  assert.ok(src.includes("resolved.push(MANAGED_FACTORY_BUG_LABEL, EXAMPLE_TRADING_FACTORY_LABEL)"), "managed labels must be auto-added for example-trading -> astrochicken routing");
});
