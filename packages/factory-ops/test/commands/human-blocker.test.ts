import { makeSandboxCredentialBlocker } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildHumanBlockerPacket, buildHumanBlockerBody, buildHumanBlockerSignature, ensureHumanBlockerIssue, extractHumanBlockerPayloadFromBody, parseHumanBlocker, parseHumanResponse, persistHumanBlockerPacket, validateHumanBlockerPacket } from "../../src/commands/human-blocker.ts";

test("parseHumanBlocker accepts strict supported blocker payloads only", () => {
  const valid = parseHumanBlocker(makeSandboxCredentialBlocker());
  assert.equal(valid?.kind, "missing_credentials");

  const invalid = parseHumanBlocker({
    kind: "legal_review",
    exact_request: "Ask legal",
    why_blocked: "No idea",
    unblock_condition: "Someone says yes",
  }, null);
  assert.equal(invalid, null);
});

test("buildHumanBlockerBody emits machine payload and human response template", () => {
  const body = buildHumanBlockerBody({
    repo: "recallnet/astrochicken",
    sourceIssueNumber: 1484,
    sourceIssueTitle: "Implement managed external-factory supervisor lifecycle",
    goalIssueNumber: 1478,
    milestoneTitle: "goal-1478-wave-1",
    blocker: {
      kind: "owner_decision",
      exact_request: "Choose billing provider",
      why_blocked: "Repo and docs do not specify the owner decision",
      unblock_condition: "A provider is chosen",
      owner_hint: "Product owner",
    },
    factoryId: "mothership",
    signature: buildHumanBlockerSignature({
      sourceIssueNumber: 1484,
      goalIssueNumber: 1478,
      kind: "owner_decision",
      exactRequest: "Choose billing provider",
      unblockCondition: "A provider is chosen",
    }),
  });

  assert.match(body, /Machine-generated human blocker request/);
  assert.match(body, /## Human Response/);
  assert.match(body, /Status: satisfied\|rejected\|needs-clarification/);
  assert.match(body, /Human-Blocker-Signature:/);
});

test("persistHumanBlockerPacket writes canonical durable packet copy", () => {
  const repo = mkdtempSync(join(tmpdir(), "human-blocker-"));
  const packet = buildHumanBlockerPacket({
    repo: "recallnet/astrochicken",
    sourceIssueNumber: 1484,
    sourceIssueTitle: "Implement import flow",
    goalIssueNumber: 1478,
    blocker: {
      kind: "external_input",
      exact_request: "Provide sample CSV",
      why_blocked: "No representative sample exists in repo or GitHub",
      unblock_condition: "CSV is attached",
    },
    factoryId: "mothership",
    signature: buildHumanBlockerSignature({
      sourceIssueNumber: 1484,
      goalIssueNumber: 1478,
      kind: "external_input",
      exactRequest: "Provide sample CSV",
      unblockCondition: "CSV is attached",
    }),
  });
  const validation = validateHumanBlockerPacket(packet);
  assert.equal(validation.ok, true, validation.errors.join(","));
  assert.equal(packet.handoff_kind, "human_blocker_review");
  assert.equal(packet.resource_refs.source_issue_number, 1484);
  const persisted = persistHumanBlockerPacket({ repo, packet });
  const parsed = JSON.parse(readFileSync(persisted.packet_path, "utf8"));
  assert.equal(parsed.packet_type, "human_blocker");
  assert.equal(parsed.handoff_owner, "supervisor");
  assert.match(persisted.packet_path, /\.hatch\/mothership\/packets\/human_blocker\//);
});

test("extractHumanBlockerPayloadFromBody round-trips fenced payload", () => {
  const signature = buildHumanBlockerSignature({
    sourceIssueNumber: 1484,
    goalIssueNumber: 1478,
    kind: "external_input",
    exactRequest: "Provide sample CSV",
    unblockCondition: "CSV is attached",
  });
  const body = buildHumanBlockerBody({
    repo: "recallnet/astrochicken",
    sourceIssueNumber: 1484,
    sourceIssueTitle: "Implement import flow",
    goalIssueNumber: 1478,
    blocker: {
      kind: "external_input",
      exact_request: "Provide sample CSV",
      why_blocked: "No representative sample exists in repo or GitHub",
      unblock_condition: "CSV is attached",
    },
    signature,
  });
  const extracted = extractHumanBlockerPayloadFromBody(body);
  assert.equal(extracted?.signature, signature);
  assert.equal(extracted?.payload?.packet_type, "human_blocker");
  assert.match(String(extracted?.payload?.packet_id || ""), /^human_blocker_/);
  assert.equal(extracted?.payload?.source_issue_number, 1484);
  assert.equal(extracted?.payload?.blocker_kind, "external_input");
});

test("parseHumanResponse reads latest structured human response comment", () => {
  const out = parseHumanResponse([
    { body: "noise" },
    { body: "## Human Response\nStatus: satisfied\nDecision/Input: secret stored in 1Password item X\nNotes: use sandbox only" },
  ]);
  assert.equal(out?.status, "satisfied");
  assert.match(String(out?.decision_input || ""), /1Password/);
});

test("ensureHumanBlockerIssue dedupes by signature and merges blocked_by", () => {
  const createdCalls = [];
  const ghFn = (args) => {
    createdCalls.push(args);
    if (args[0] === "issue" && args[1] === "create") {
      return { ok: true, stdout: "https://github.com/recallnet/astrochicken/issues/2001", stderr: "" };
    }
    return { ok: true, stdout: "", stderr: "" };
  };
  const ghJsonFn = (args, fallback = []) => {
    const cmd = args.join(" ");
    if (cmd.includes("issue view 1484")) return { number: 1484, title: "Implement import flow" };
    if (cmd.includes("--label human")) return [
      {
        number: 1999,
        url: "https://github.com/recallnet/astrochicken/issues/1999",
        body: "Human-Blocker-Signature: sha256:other",
      },
    ];
    return fallback;
  };

  const first = ensureHumanBlockerIssue({
    repo: "recallnet/astrochicken",
    issueNumber: 1484,
    goalIssueNumber: 1478,
    milestoneTitle: "goal-1478-wave-1",
    blockedByRaw: "[88]",
    humanBlockerRaw: JSON.stringify(makeSandboxCredentialBlocker()),
    ghFn,
    ghJsonFn,
  });
  assert.equal(first.ok, true);
  assert.equal(first.issue_number, 2001);
  assert.deepEqual(JSON.parse(first.effective_blocked_by), [88, 2001]);

  const signature = buildHumanBlockerSignature({
    sourceIssueNumber: 1484,
    goalIssueNumber: 1478,
    kind: "missing_credentials",
    exactRequest: "Provide sandbox API key",
    unblockCondition: "Credential location is provided",
  });
  const second = ensureHumanBlockerIssue({
    repo: "recallnet/astrochicken",
    issueNumber: 1484,
    goalIssueNumber: 1478,
    blockedByRaw: "[88]",
    humanBlockerRaw: JSON.stringify(makeSandboxCredentialBlocker()),
    ghFn: () => ({ ok: true, stdout: "", stderr: "" }),
    ghJsonFn: (args, fallback = []) => {
      const cmd = args.join(" ");
      if (cmd.includes("issue view 1484")) return { number: 1484, title: "Implement import flow" };
      if (cmd.includes("--label human")) {
        return [{
          number: 2002,
          url: "https://github.com/recallnet/astrochicken/issues/2002",
          body: `Human-Blocker-Signature: ${signature}`,
        }];
      }
      return fallback;
    },
  });
  assert.equal(second.created, false);
  assert.equal(second.issue_number, 2002);
  assert.deepEqual(JSON.parse(second.effective_blocked_by), [88, 2002]);
});
