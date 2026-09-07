import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDefaultActionRegistry } from "./action-registry.js";
import { Context } from "./context.js";

import type { ActionExecutionRequest } from "./action-registry.js";
import type { Node } from "./graph.js";

const originalPath = process.env.PATH || "";
const tempRoots: string[] = [];

function makeRequest(attrs: Record<string, string> = {}): ActionExecutionRequest {
	return {
		signal: AbortSignal.timeout(5000),
		node: { id: "list_executable_goals", attrs } as Node,
		ctx: new Context(),
		input: "",
		workDir: ".",
		env: {},
	};
}

function createFakeGhHome() {
	const root = mkdtempSync(join(tmpdir(), "hatch-gh-"));
	tempRoots.push(root);
	const binDir = join(root, "bin");
	mkdirSync(binDir, { recursive: true });
	const scriptPath = join(binDir, "gh");
	writeFileSync(
		scriptPath,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "issue" && args[1] === "list") {
  process.stdout.write(JSON.stringify([{ number: 1844, title: "Goal 1844" }]));
  process.exit(0);
}
if (args[0] === "api" && args[1] === "graphql") {
  process.stdout.write(JSON.stringify({ data: { repository: { i1844: { blockedBy: { nodes: [] } } } } }));
  process.exit(0);
}
if (args[0] === "api" && String(args[1] || "").includes("/issues/1844/sub_issues")) {
  process.stdout.write("[]");
  process.exit(0);
}
process.stderr.write("unexpected gh args: " + JSON.stringify(args));
process.exit(1);
`,
		"utf8",
	);
	chmodSync(scriptPath, 0o755);
	process.env.PATH = `${binDir}:${originalPath}`;
}

function createRepoRootWithExecutionPathPacket() {
	const repoRoot = mkdtempSync(join(tmpdir(), "hatch-goal-selector-"));
	tempRoots.push(repoRoot);
	const packetDir = join(repoRoot, ".hatch", "example-trading", "packets", "goal_execution_path_packet");
	mkdirSync(packetDir, { recursive: true });
	writeFileSync(
		join(packetDir, "goal-1844-medium.json"),
		JSON.stringify({
			schema_version: "goal_execution_path_packet/v1",
			packet_type: "goal_execution_path_packet",
			packet_id: "goal_execution_path_packet_test_1844",
			created_at: "2026-04-03T00:00:00.000Z",
			packet_state: "open",
			factory_id: "example-trading",
			run_id: "",
			pipeline: "managed_software_delivery_domain",
			node_id: "list_executable_goals",
			target_repo: "example-org/example-trading",
			control_plane_repo: "recallnet/astrochicken",
			goal_issue_number: "1844",
			execution_path: "medium",
			routing_contract_version: "v1",
			classification_version: "v1",
			decomposition_state: "approved",
			planning_state: "approved",
			classified_at: "2026-04-03T00:00:00.000Z",
			classified_by: "test",
			classification_reason: "seed medium-path routing",
			classification_signals: {},
			understanding_risk: "low",
			rationale_required: false,
			handoff_owner: "goal.execution_path_router",
			handoff_kind: "goal_execution_path",
			resource_refs: { goal_issue_number: "1844" },
			inspection_commands: [],
			execution_commands: [],
			verify_commands: [],
			expected_outcomes: ["dispatchable"],
			preserve_work: {},
			operator_prompt: "use packet",
		}),
		"utf8",
	);
	return repoRoot;
}

afterEach(() => {
	process.env.PATH = originalPath;
	while (tempRoots.length > 0) {
		const path = tempRoots.pop();
		if (!path) continue;
		rmSync(path, { recursive: true, force: true });
	}
});

describe("software.list_executable_goals action", () => {
	it("matches the CLI path by forwarding repo root for execution-path packet hydration", async () => {
		createFakeGhHome();
		const repoRoot = createRepoRootWithExecutionPathPacket();

		const registry = createDefaultActionRegistry();
		const action = registry.get("software.list_executable_goals");

		expect(action).toBeDefined();
		const result = await action!.execute(makeRequest({
			action_repo: "example-org/example-trading",
			action_repo_root: repoRoot,
			action_factory_id: "example-trading",
			action_runs_dir: join(repoRoot, ".hatch", "example-trading", "runs"),
			action_max_concurrent: "3",
		}));

		expect(JSON.parse(String(result.output))).toMatchObject({
			executable_goals: [1844],
			goal_execution_paths: { "1844": "medium" },
			count: 1,
			capped: false,
		});
	});
});
