import { createHash } from "node:crypto";

import { trim, parseJson, gh, ghJson } from "../lib/cli-helpers.ts";
import { findFactoryLabelByName } from "../lib/factory-label-registry.ts";
import { mothershipFactoryLabelRegistry } from "../lib/mothership-label-overlay.ts";
import {
  buildNamedPacketEnvelope,
  buildPacketTakeoverContract,
  makePacketId,
  persistNamedPacket,
  validatePacketTakeoverContract,
} from "../lib/packet-core.ts";




function toPositiveInt(value) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}


function toArray(raw) {
  if (Array.isArray(raw)) return raw;
  return parseJson(raw, []);
}

function normalizeKind(value = "") {
  const normalized = trim(value).toLowerCase();
  if (["missing_credentials", "owner_decision", "external_input"].includes(normalized)) return normalized;
  return "";
}

export function parseHumanBlocker(raw = "", fallback = null) {
  if (!raw) return fallback;
  const parsed = typeof raw === "string" ? parseJson(raw, null) : raw;
  if (!parsed || typeof parsed !== "object") return fallback;

  const kind = normalizeKind(parsed.kind || parsed.blocker_kind || "");
  const exactRequest = trim(parsed.exact_request || parsed.required_input || "");
  const whyBlocked = trim(parsed.why_blocked || parsed.reason || "");
  const unblockCondition = trim(parsed.unblock_condition || "");
  const ownerHint = trim(parsed.owner_hint || "");
  const titleHint = trim(parsed.title_hint || "");

  if (!kind || !exactRequest || !whyBlocked || !unblockCondition) return fallback;
  return {
    kind,
    exact_request: exactRequest,
    why_blocked: whyBlocked,
    unblock_condition: unblockCondition,
    owner_hint: ownerHint,
    title_hint: titleHint,
  };
}

export function buildHumanBlockerSignature({
  sourceIssueNumber = 0,
  goalIssueNumber = 0,
  kind = "",
  exactRequest = "",
  unblockCondition = "",
} = {}) {
  const seed = JSON.stringify({
    source_issue_number: toPositiveInt(sourceIssueNumber),
    goal_issue_number: toPositiveInt(goalIssueNumber),
    kind: normalizeKind(kind),
    exact_request: trim(exactRequest),
    unblock_condition: trim(unblockCondition),
  });
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function buildHumanTitle({ issueNumber = 0, blocker = {} } = {}) {
  const titleHint = trim(blocker?.title_hint || "");
  const fallback = {
    missing_credentials: "Provide required credentials or account access",
    owner_decision: "Provide owner decision",
    external_input: "Provide required external input",
  }[normalizeKind(blocker?.kind || "")] || "Provide required human input";
  return `[human] ${titleHint || fallback} for issue #${toPositiveInt(issueNumber)}`;
}

export function buildHumanBlockerBody({
  repo = "",
  sourceIssueNumber = 0,
  sourceIssueTitle = "",
  goalIssueNumber = 0,
  milestoneTitle = "",
  blocker = {},
  factoryId = "",
  sourceRepo = "",
  signature = "",
} = {}) {
  const payload = buildHumanBlockerPacket({
    repo,
    sourceIssueNumber,
    sourceIssueTitle,
    goalIssueNumber,
    milestoneTitle,
    blocker,
    factoryId,
    sourceRepo,
    signature,
  });

  return [
    "Machine-generated human blocker request.",
    "",
    "This issue exists only when the factory cannot proceed autonomously because it lacks a required secret/account access, an owner-only decision, or an external input that cannot be derived from the repo, docs, GitHub state, or current config.",
    "",
    `Blocked work: #${payload.source_issue_number} ${payload.source_issue_title}`.trim(),
    payload.goal_issue_number > 0 ? `Parent goal: #${payload.goal_issue_number}` : "",
    payload.milestone_title ? `Wave milestone: ${payload.milestone_title}` : "",
    payload.owner_hint ? `Likely owner: ${payload.owner_hint}` : "",
    "",
    `Exact input needed: ${payload.exact_request}`,
    `Why the factory cannot proceed autonomously: ${payload.why_blocked}`,
    `Unblock condition: ${payload.unblock_condition}`,
    "",
    "Supervisor policy:",
    "- The supervisor must re-review this blocker on later ticks before leaving it to a human.",
    "- If the supervisor can resolve the blocker without human input, it should do that and close this issue.",
    "- Keep this issue open only while the exact missing input remains genuinely human-owned.",
    "",
    "Human response format:",
    "1. Add a comment using the structure below.",
    "2. Close this issue once the final decision/input has been provided or explicitly rejected.",
    "",
    "```text",
    "## Human Response",
    "Status: satisfied|rejected|needs-clarification",
    "Decision/Input: <exact decision, credential handoff location, or provided artifact>",
    "Notes: <optional context>",
    "```",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    `Human-Blocker-Signature: ${payload.signature_hash}`,
  ].filter(Boolean).join("\n");
}

export function buildHumanBlockerPacket({
  repo = "",
  sourceIssueNumber = 0,
  sourceIssueTitle = "",
  goalIssueNumber = 0,
  milestoneTitle = "",
  blocker = {},
  factoryId = "",
  sourceRepo = "",
  signature = "",
} = {}) {
  const packetId = makePacketId({
    packetType: "human_blocker",
    identity: {
      source_issue_number: toPositiveInt(sourceIssueNumber),
      goal_issue_number: toPositiveInt(goalIssueNumber),
      blocker_kind: normalizeKind(blocker?.kind || ""),
      signature_hash: trim(signature),
    },
  });
  return {
    ...buildNamedPacketEnvelope({
      schemaVersion: "human_blocker.v1",
      packetType: "human_blocker",
      packetId,
      factoryId: trim(factoryId),
      targetRepo: trim(sourceRepo) || trim(repo),
      controlPlaneRepo: trim(sourceRepo) || trim(repo),
    }),
    ...buildPacketTakeoverContract({
      handoffOwner: "supervisor",
      handoffKind: "human_blocker_review",
      resourceRefs: {
        source_issue_number: toPositiveInt(sourceIssueNumber),
        goal_issue_number: toPositiveInt(goalIssueNumber),
        milestone_title: trim(milestoneTitle),
        source_repo: trim(sourceRepo) || trim(repo),
      },
      inspectionCommands: [
        `gh issue view ${toPositiveInt(sourceIssueNumber) || "<source-issue>"} --repo '${trim(sourceRepo) || trim(repo)}' --json number,title,state,body,comments`,
      ],
      executionCommands: [
        "If the missing input is now available from repo, docs, or GitHub state, apply it directly and close the human blocker issue.",
        "If the input remains genuinely human-owned, keep the blocker issue open and preserve the exact unblock condition.",
      ],
      verifyCommands: [
        "Confirm the source issue is either unblocked with a concrete next step or still waiting on the exact human-owned prerequisite.",
      ],
      expectedOutcomes: [
        "A supervisor can decide whether the blocker is still genuinely human-owned without reconstructing context from freeform comments alone.",
      ],
      preserveWork: {
        preserve_work_required: false,
      },
      operatorPrompt: "Start from the source issue and blocker issue state, verify whether the prerequisite still requires a human, resolve it directly when possible, and leave the blocker open only when the missing input remains genuinely outside autonomous authority.",
    }),
    source_issue_number: toPositiveInt(sourceIssueNumber),
    source_issue_title: trim(sourceIssueTitle),
    goal_issue_number: toPositiveInt(goalIssueNumber),
    milestone_title: trim(milestoneTitle),
    blocker_kind: normalizeKind(blocker?.kind || ""),
    exact_request: trim(blocker?.exact_request || ""),
    why_blocked: trim(blocker?.why_blocked || ""),
    unblock_condition: trim(blocker?.unblock_condition || ""),
    owner_hint: trim(blocker?.owner_hint || ""),
    factory_id: trim(factoryId),
    source_repo: trim(sourceRepo) || trim(repo),
    signature_hash: trim(signature),
  };
}

export function validateHumanBlockerPacket(packet = {}) {
  const errors = [];
  if (trim(packet?.schema_version) !== "human_blocker.v1") {
    errors.push(`invalid_schema_version:${trim(packet?.schema_version) || "(empty)"}`);
  }
  if (trim(packet?.packet_type) !== "human_blocker") {
    errors.push(`invalid_packet_type:${trim(packet?.packet_type) || "(empty)"}`);
  }
  if (!toPositiveInt(packet?.source_issue_number)) errors.push("missing_required_field:source_issue_number");
  if (!trim(packet?.blocker_kind)) errors.push("missing_required_field:blocker_kind");
  if (!trim(packet?.exact_request)) errors.push("missing_required_field:exact_request");
  if (!trim(packet?.why_blocked)) errors.push("missing_required_field:why_blocked");
  if (!trim(packet?.unblock_condition)) errors.push("missing_required_field:unblock_condition");
  const handoff = validatePacketTakeoverContract(packet, { required: true });
  errors.push(...handoff.errors);
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function persistHumanBlockerPacket({ repo = "", packet = {} } = {}) {
  const validation = validateHumanBlockerPacket(packet);
  if (!validation.ok) {
    throw new Error(`invalid_human_blocker_packet:${validation.errors.join(",")}`);
  }
  return persistNamedPacket({ repo, packet });
}

export function extractHumanBlockerPayloadFromBody(body = "") {
  const signature = String(body || "").match(/Human-Blocker-Signature:\s*(sha256:[a-f0-9]+)/i)?.[1] || "";
  const fenced = String(body || "").match(/```json\s*([\s\S]*?)\s*```/i)?.[1] || "";
  const parsed = parseJson(fenced, null);
  if (!parsed || typeof parsed !== "object") return null;
  return {
    payload: parsed,
    signature: signature || trim(parsed.signature_hash || ""),
  };
}

export function parseHumanResponse(comments = []) {
  const entries = Array.isArray(comments) ? comments : [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const body = String(entries[i]?.body || "");
    if (!/##\s*Human Response/i.test(body)) continue;
    const status = trim(body.match(/Status:\s*([^\n]+)/i)?.[1] || "").toLowerCase();
    const decisionInput = trim(body.match(/Decision\/Input:\s*([^\n]+)/i)?.[1] || "");
    const notes = trim(body.match(/Notes:\s*([^\n]+)/i)?.[1] || "");
    if (!status) continue;
    return {
      status,
      decision_input: decisionInput,
      notes,
      body,
    };
  }
  return null;
}

export function ensureHumanBlockerIssue({
  repo = "",
  issueNumber = 0,
  goalIssueNumber = 0,
  milestoneTitle = "",
  humanBlockerRaw = "",
  blockedByRaw = "[]",
  factoryId = "",
  sourceRepo = "",
  ghFn = gh,
  ghJsonFn = ghJson,
} = {}) {
  const sourceIssueNumber = toPositiveInt(issueNumber);
  const goalNumber = toPositiveInt(goalIssueNumber);
  const blocker = parseHumanBlocker(humanBlockerRaw, null);
  const existingBlockedBy = toArray(blockedByRaw)
    .map((value) => toPositiveInt(value))
    .filter((value) => value > 0);

  if (!trim(repo) || sourceIssueNumber <= 0) {
    return { ok: false, error: "missing_repo_or_issue", effective_blocked_by: JSON.stringify(existingBlockedBy) };
  }

  if (!blocker) {
    return {
      ok: true,
      created: false,
      issue_number: 0,
      issue_url: "",
      effective_blocked_by: JSON.stringify(existingBlockedBy),
    };
  }

  const viewed = ghJsonFn([
    "issue", "view", String(sourceIssueNumber), "--repo", trim(repo), "--json", "number,title",
  ], {});
  const sourceIssueTitle = trim(viewed?.title || "");
  const signature = buildHumanBlockerSignature({
    sourceIssueNumber,
    goalIssueNumber: goalNumber,
    kind: blocker.kind,
    exactRequest: blocker.exact_request,
    unblockCondition: blocker.unblock_condition,
  });
  const packet = buildHumanBlockerPacket({
    repo,
    sourceIssueNumber,
    sourceIssueTitle,
    goalIssueNumber: goalNumber,
    milestoneTitle,
    blocker,
    factoryId,
    sourceRepo,
    signature,
  });
  persistHumanBlockerPacket({ repo, packet });

  const registry = mothershipFactoryLabelRegistry();
  const humanLabel = findFactoryLabelByName("human", registry);
  const awaitingHumanLabel = findFactoryLabelByName("awaiting-human", registry);

  if (humanLabel) {
    ghFn([
      "label",
      "create",
      humanLabel.name,
      "--repo",
      trim(repo),
      "--description",
      humanLabel.description,
      "--color",
      humanLabel.color,
    ]);
  }

  if (awaitingHumanLabel) {
    ghFn([
      "label",
      "create",
      awaitingHumanLabel.name,
      "--repo",
      trim(repo),
      "--description",
      awaitingHumanLabel.description,
      "--color",
      awaitingHumanLabel.color,
    ]);
  }

  const humanLabelName = humanLabel?.name || "human";
  const awaitingHumanLabelName = awaitingHumanLabel?.name || "awaiting-human";

  const existing = ghJsonFn([
    "issue", "list", "--repo", trim(repo), "--state", "open", "--label", humanLabelName, "--limit", "200",
    "--json", "number,title,body,url",
  ], []).find((item) => String(item?.body || "").includes(`Human-Blocker-Signature: ${signature}`));

  const withMergedBlockedBy = (humanIssueNumber) => JSON.stringify(
    Array.from(new Set([...existingBlockedBy, toPositiveInt(humanIssueNumber)].filter((n) => n > 0))).sort((a, b) => a - b),
  );

  if (existing?.number) {
    return {
      ok: true,
      created: false,
      issue_number: toPositiveInt(existing.number),
      issue_url: trim(existing.url || ""),
      effective_blocked_by: withMergedBlockedBy(existing.number),
    };
  }

  const title = buildHumanTitle({ issueNumber: sourceIssueNumber, blocker });
  const body = buildHumanBlockerBody({
    repo,
    sourceIssueNumber,
    sourceIssueTitle,
    goalIssueNumber: goalNumber,
    milestoneTitle,
    blocker,
    factoryId,
    sourceRepo,
    signature,
  });

  const created = ghFn([
    "issue", "create", "--repo", trim(repo), "--title", title, "--body", body, "--label", humanLabelName, "--label", awaitingHumanLabelName,
  ]);
  if (!created.ok) {
    return {
      ok: false,
      error: trim(created.stderr || created.stdout || "create_human_blocker_failed"),
      effective_blocked_by: JSON.stringify(existingBlockedBy),
    };
  }

  const issueUrl = trim(created.stdout || "");
  const createdNumber = toPositiveInt(issueUrl.match(/\/issues\/(\d+)/)?.[1] || "");
  return {
    ok: createdNumber > 0,
    created: true,
    issue_number: createdNumber,
    issue_url: issueUrl,
    effective_blocked_by: withMergedBlockedBy(createdNumber),
  };
}
