import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadFactoryRegistry, parseFactoryRegistryDocument, validateFactoryRegistryDocument } from "./registry.js";

describe("factory registry daemonStatus", () => {
	it("accepts daemonStatus metadata when present", () => {
		const parsed = parseFactoryRegistryDocument({
			schema: "hatch.factory.registry.v1",
			factories: [
				{
					id: "mothership",
					instance_id: "mothership",
					repo: "recallnet/astrochicken",
					graphs: [{ id: "goal_queue", path: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_queue.dot" }],
					daemonStatus: {
						status: "running",
						pid: 1234,
						last_tick_at: "2026-03-08T20:00:00Z",
						run_id: "abc123",
					},
				},
			],
		});

		expect(parsed.factories[0].daemonStatus?.status).toBe("running");
		expect(parsed.factories[0].daemonStatus?.pid).toBe(1234);
	});

	it("keeps daemonStatus optional for existing registries", () => {
		const issues = validateFactoryRegistryDocument({
			schema: "hatch.factory.registry.v1",
			factories: [
				{
					id: "external",
					repo: "example/external-factory",
					graphs: [{ id: "issue_worker", path: "factories/external/graphs/issue_worker.dot" }],
				},
			],
		});

		expect(issues).toEqual([]);
	});

	it("accepts optional fac_* instance ids on legacy factories[] entries", () => {
		const issues = validateFactoryRegistryDocument({
			schema: "hatch.factory.registry.v1",
			factories: [
				{
					id: "external",
					instance_id: "fac_01JQ7M8JABCDEFG",
					repo: "example/external-factory",
					graphs: [{ id: "issue_worker", path: "factories/external/graphs/issue_worker.dot" }],
				},
			],
		});

		expect(issues).toEqual([]);
	});

	it("rejects malformed legacy factories[] instance ids", () => {
		const issues = validateFactoryRegistryDocument({
			schema: "hatch.factory.registry.v1",
			factories: [
				{
					id: "external",
					instance_id: "external",
					repo: "example/external-factory",
					graphs: [{ id: "issue_worker", path: "factories/external/graphs/issue_worker.dot" }],
				},
			],
		});

		expect(issues).toContainEqual({
			path: "factories[0].instance_id",
			message: 'must be a valid fac_* id or "mothership"',
		});
	});

	it("accepts canonical instances[] registries for managed factories", () => {
		const issues = validateFactoryRegistryDocument({
			schema: "hatch.factory.registry.v1",
			instances: [
				{
					instance_id: "brainstorm",
					kind_id: "brainstorm",
					target_repo: "example-org/example-notes",
					status: "registered",
					assigned_host_id: "unassigned",
					graphs: [{ id: "factory_supervisor_tick", path: "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot" }],
					daemonStatus: { status: "stopped" },
					service_tier: "gold",
					scheduler_weight: 3,
					reserved_capacity: 1,
					upgrade_channel: "stable",
					allowed_runtime_version: ">=1.2.0 <2.0.0",
					support_owner: "factory-platform",
					feature_flags: {
						wave_autoretry: "enabled",
					},
				},
			],
		});

		expect(issues).toEqual([]);
	});

	it("keeps service profile metadata when normalizing instances[] via loadFactoryRegistry", () => {
		const tempRoot = mkdtempSync(join(tmpdir(), "registry-v2-"));
		const registryPath = join(tempRoot, "factory-registry.json");
		writeFileSync(registryPath, JSON.stringify({
			schema: "hatch.factory.registry.v1",
			instances: [
				{
					instance_id: "brainstorm",
					kind_id: "brainstorm",
					target_repo: "example-org/example-notes",
					status: "registered",
					assigned_host_id: "unassigned",
					service_tier: "gold",
					scheduler_weight: 3,
					reserved_capacity: 1,
					upgrade_channel: "stable",
					allowed_runtime_version: ">=1.2.0 <2.0.0",
					support_owner: "factory-platform",
					feature_flags: {
						wave_autoretry: "enabled",
					},
				},
			],
		}), "utf8");

		try {
			const registry = loadFactoryRegistry({ rootDir: tempRoot });
			expect(registry.factories[0]).toMatchObject({
				service_tier: "gold",
				scheduler_weight: 3,
				reserved_capacity: 1,
				upgrade_channel: "stable",
				allowed_runtime_version: ">=1.2.0 <2.0.0",
				support_owner: "factory-platform",
				feature_flags: {
					wave_autoretry: "enabled",
				},
			});
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("injects default service profile metadata for legacy instances[] rows", () => {
		const tempRoot = mkdtempSync(join(tmpdir(), "registry-v2-defaults-"));
		const registryPath = join(tempRoot, "factory-registry.json");
		writeFileSync(registryPath, JSON.stringify({
			schema: "hatch.factory.registry.v1",
			instances: [
				{
					instance_id: "brainstorm",
					kind_id: "brainstorm",
					target_repo: "example-org/example-notes",
					status: "registered",
					assigned_host_id: "unassigned",
				},
			],
		}), "utf8");

		try {
			const registry = loadFactoryRegistry({ rootDir: tempRoot });
			expect(registry.factories[0]).toMatchObject({
				service_tier: "standard",
				scheduler_weight: 1,
				reserved_capacity: 0,
				upgrade_channel: "stable",
				allowed_runtime_version: "*",
				support_owner: "ops",
				feature_flags: {},
			});
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("rejects invalid service profile metadata values", () => {
		const issues = validateFactoryRegistryDocument({
			schema: "hatch.factory.registry.v1",
			instances: [
				{
					instance_id: "brainstorm",
					kind_id: "brainstorm",
					target_repo: "example-org/example-notes",
					status: "registered",
					assigned_host_id: "unassigned",
					service_tier: "tier!",
					scheduler_weight: 0,
					reserved_capacity: -1,
					upgrade_channel: "stable/channel",
					allowed_runtime_version: "version(one)",
					support_owner: "",
					feature_flags: {
						good: "",
					},
				},
			],
		});

		expect(issues).toContainEqual({ path: "instances[0].service_tier", message: "must match /^[A-Za-z0-9-]+$/" });
		expect(issues).toContainEqual({ path: "instances[0].scheduler_weight", message: "must be an integer >= 1" });
		expect(issues).toContainEqual({ path: "instances[0].reserved_capacity", message: "must be an integer >= 0" });
		expect(issues).toContainEqual({ path: "instances[0].upgrade_channel", message: "must match /^[A-Za-z0-9-]+$/" });
		expect(issues).toContainEqual({ path: "instances[0].allowed_runtime_version", message: "must be a semver range expression" });
		expect(issues).toContainEqual({ path: "instances[0].support_owner", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "instances[0].feature_flags.good", message: "must be a non-empty string" });
	});

	it("rejects invalid daemonStatus status values", () => {
		const issues = validateFactoryRegistryDocument({
			schema: "hatch.factory.registry.v1",
			factories: [
				{
					id: "bad",
					repo: "recallnet/astrochicken",
					graphs: [{ id: "goal_queue", path: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_queue.dot" }],
					daemonStatus: { status: "paused" },
				},
			],
		});

		expect(issues.some((issue) => issue.path.endsWith("daemonStatus.status"))).toBe(true);
	});

	it("parses repository registry with brainstorm and example-trading entries", () => {
		const registryPath = new URL("../../../../factory-registry.json", import.meta.url);
		const raw = readFileSync(registryPath, "utf8");
		const parsed = parseFactoryRegistryDocument(JSON.parse(raw));
		const brainstorm = parsed.factories.find((factory) => factory.id === "brainstorm");
		const replayLab = parsed.factories.find((factory) => factory.id === "example-trading");

		expect(brainstorm?.repo).toBe("example-org/example-notes");
		expect(brainstorm?.graphs).toEqual([
			{
				id: "factory_supervisor_tick",
				path: "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot",
			},
		]);
		expect(brainstorm?.daemonStatus).toEqual({ status: "stopped" });

		expect(replayLab?.repo).toBe("example-org/example-trading");
		expect(replayLab?.graphs).toEqual([
			{
				id: "factory_supervisor_tick",
				path: "factories/example-trading/graphs/factory_supervisor_tick.dot",
			},
			{
				id: "goal_intake_decompose",
				path: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot",
			},
			{
				id: "goal_queue",
				path: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_queue.dot",
			},
			{
				id: "goal_run",
				path: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_run.dot",
			},
			{
				id: "goal_execute",
				path: "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
			},
			{
				id: "goal_issue_execute",
				path: "docs/contracts/workflow-ir/capability-software-development/goal_issue_execute.dot",
			},
		]);

		const replayLabGraphPaths = replayLab?.graphs.map((graph) => graph.path) ?? [];
		expect(replayLabGraphPaths).toContain("docs/contracts/workflow-ir/capability-software-development/goal_execute.dot");
		expect(replayLabGraphPaths).toContain("docs/contracts/workflow-ir/capability-software-development/goal_issue_execute.dot");
		expect(replayLabGraphPaths).not.toContain("docs/contracts/workflow-ir/capability-wave-dispatch/wave_dispatch.dot");
	});
});
