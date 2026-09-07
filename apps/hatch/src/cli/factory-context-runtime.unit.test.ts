import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	applyFactoryContextToEngineContext,
	seedRunStateFactoryContext,
	type FactoryContext,
} from "./factory-context-runtime.js";
import { Context } from "../pipeline/context.js";

describe("factory context runtime timeout seeding", () => {
	it("seeds goal_decomposition_timeouts from factory config capability contract", () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-runtime-"));
		try {
			const factoryConfigPath = join(root, "factory.config.json");
			writeFileSync(factoryConfigPath, JSON.stringify({
				schema: "hatch.factory.config.v1",
				factory_id: "mothership",
				target_repo: "recallnet/astrochicken",
				control_plane_repo: "recallnet/astrochicken",
				dispatch: { graph: "graphs/factory_supervisor_tick.dot" },
				skills: { supervisor: "skills/supervisor" },
				scenarios: { root: "scenarios" },
				pipeline: { supervisor_tick: "graphs/factory_supervisor_tick.dot" },
				runs_dir: ".hatch/mothership/runs",
				trust: { domain: "mothership.local", roles: ["mothership.local.tool"] },
				capabilities: {
					goal_decomposition: {
						timeouts: {
							issue_draft: "45m",
						},
					},
					demo: {
						policy: "terminal",
					},
				},
			}, null, 2), "utf-8");

			const context = new Context();
			const factoryContext: FactoryContext = {
				factory_root: root,
				factory_config_path: factoryConfigPath,
				factory_id: "mothership",
				target_repo: "recallnet/astrochicken",
				control_plane_repo: "recallnet/astrochicken",
				kind_id: "mothership",
				instance_id: "mothership",
				kind_path: join(root, "kind.json"),
				instance_path: join(root, ".hatch", "instance.json"),
				destinations_json: '{"goal_issues":{"repo":"recallnet/astrochicken"}}',
				repo: join(root, "workspace"),
				runs_dir: join(root, ".hatch/mothership/runs"),
				scenarios_root: join(root, "scenarios"),
				trust_domain: "mothership.local",
				trust_role: "mothership.local.tool",
				factory_mode: "managed",
				factory_mode_source: [{
					source: "factory.config.json#kind_id",
					mode: "managed",
					precedence: "high",
					detail: "managed_overlay=kind_id",
				}],
			};

			applyFactoryContextToEngineContext(context, factoryContext);
			const seeded = JSON.parse(context.get("goal_decomposition_timeouts"));
			expect(seeded.issue_draft).toBe("45m");
			expect(seeded.issue_judge).toBe("30m");
			expect(context.get("demo_policy")).toBe("terminal");
			expect(context.get("target_repo")).toBe("recallnet/astrochicken");
			expect(context.get("target_repo")).toBe("recallnet/astrochicken");
			expect(context.get("repo")).toBe(join(root, "workspace"));
			expect(context.get("kind_id")).toBe("mothership");
			expect(context.get("instance_id")).toBe("mothership");
			expect(context.get("kind_path")).toBe(join(root, "kind.json"));
			expect(context.get("instance_path")).toBe(join(root, ".hatch", "instance.json"));
			expect(context.get("destinations_json")).toBe('{"goal_issues":{"repo":"recallnet/astrochicken"}}');
			expect(context.get("destinations")).toBe('{"goal_issues":{"repo":"recallnet/astrochicken"}}');
			expect(context.get("trust_domain")).toBe("mothership.local");
			expect(context.get("trust_role")).toBe("mothership.local.tool");
			expect(context.get("factory_mode")).toBe("managed");
			expect(JSON.parse(context.get("factory_mode_source"))).toEqual([
				{
					source: "factory.config.json#kind_id",
					mode: "managed",
					precedence: "high",
					detail: "managed_overlay=kind_id",
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("seeds run-state context with configured demo policy", () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-runtime-"));
		try {
			const factoryConfigPath = join(root, "factory.config.json");
			writeFileSync(factoryConfigPath, JSON.stringify({
				schema: "hatch.factory.config.v1",
				factory_id: "brainstorm",
				target_repo: "example-org/brainstorm-lab",
				control_plane_repo: "recallnet/astrochicken",
				dispatch: { graph: "graphs/factory_supervisor_tick.dot" },
				skills: { supervisor: "skills/supervisor" },
				scenarios: { root: "scenarios" },
				pipeline: { supervisor_tick: "graphs/factory_supervisor_tick.dot" },
				runs_dir: ".hatch/brainstorm/runs",
				trust: { domain: "brainstorm.local", roles: ["brainstorm.local.tool"] },
				capabilities: {
					demo: {
						policy: "browser",
					},
				},
			}, null, 2), "utf-8");

			const runState = {
				schemaVersion: 1,
				runId: "run-2",
				pipelineFile: "graph.dot",
				pid: 456,
				status: "running",
				startedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				currentNode: "start",
				lastOutput: "",
				context: {},
				completedNodes: [],
				activeChildren: {},
				locksHeld: [],
				records: [],
				guard: {
					version: 1,
					counter: {},
					circuit: {
						openUntil: "",
						reason: "",
						lastTransitionAt: "",
					},
					owners: {},
				},
			} as any;

			const factoryContext: FactoryContext = {
				factory_root: root,
				factory_config_path: factoryConfigPath,
				factory_id: "brainstorm",
				target_repo: "example-org/brainstorm-lab",
				control_plane_repo: "recallnet/astrochicken",
				kind_id: "brainstorm",
				instance_id: "fac_01TEST",
				kind_path: join(root, "kind.json"),
				instance_path: join(root, ".hatch", "instance.json"),
				destinations_json: '{"goal_issues":{"repo":"recallnet/astrochicken"}}',
				repo: join(root, "worktree"),
				runs_dir: join(root, ".hatch/brainstorm/runs"),
				scenarios_root: join(root, "scenarios"),
				trust_domain: "brainstorm.local",
				trust_role: "brainstorm.local.tool",
				factory_mode: "managed",
				factory_mode_source: [],
			};

			seedRunStateFactoryContext(runState, factoryContext);
			expect(runState.context.demo_policy).toBe("browser");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("seeds run-state context with new identity keys and legacy aliases", () => {
		const runState = {
			schemaVersion: 1,
			runId: "run-1",
			pipelineFile: "graph.dot",
			pid: 123,
			status: "running",
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			currentNode: "start",
			lastOutput: "",
			context: {},
			completedNodes: [],
			activeChildren: {},
			locksHeld: [],
			records: [],
			guard: {
				version: 1,
				counter: {},
				circuit: {
					openUntil: "",
					reason: "",
					lastTransitionAt: "",
				},
				owners: {},
			},
		} as any;

		const factoryContext: FactoryContext = {
			factory_root: "/tmp/factory",
			factory_config_path: "/tmp/factory/factory.config.json",
			factory_id: "brainstorm",
			target_repo: "example-org/brainstorm-lab",
			control_plane_repo: "recallnet/astrochicken",
			kind_id: "brainstorm",
			instance_id: "fac_01TEST",
			kind_path: "/tmp/factory/kind.json",
			instance_path: "/tmp/factory/.hatch/instance.json",
			destinations_json: '{"goal_issues":{"repo":"recallnet/astrochicken"}}',
			repo: "/tmp/factory/worktree",
			runs_dir: "/tmp/runs",
			scenarios_root: "/tmp/scenarios",
			trust_domain: "brainstorm.local",
			trust_role: "brainstorm.local.tool",
			factory_mode: "managed",
			factory_mode_source: [{
				source: "factory.config.json#kind_id",
				mode: "managed",
				precedence: "high",
				detail: "managed_overlay=kind_id",
			}],
		};

		seedRunStateFactoryContext(runState, factoryContext);

		expect(runState.context.factory_root).toBe("/tmp/factory");
		expect(runState.context.factory_id).toBe("brainstorm");
		expect(runState.context.target_repo).toBe("example-org/brainstorm-lab");
		expect(runState.context.target_repo).toBe("example-org/brainstorm-lab");
		expect(runState.context.repo).toBe("/tmp/factory/worktree");
		expect(runState.context.kind_id).toBe("brainstorm");
		expect(runState.context.instance_id).toBe("fac_01TEST");
		expect(runState.context.kind_path).toBe("/tmp/factory/kind.json");
		expect(runState.context.instance_path).toBe("/tmp/factory/.hatch/instance.json");
		expect(runState.context.destinations_json).toBe('{"goal_issues":{"repo":"recallnet/astrochicken"}}');
		expect(runState.context.destinations).toBe('{"goal_issues":{"repo":"recallnet/astrochicken"}}');
		expect(runState.context.control_plane_repo).toBe("recallnet/astrochicken");
		expect(runState.context.trust_domain).toBe("brainstorm.local");
		expect(runState.context.trust_role).toBe("brainstorm.local.tool");
		expect(runState.context.factory_mode).toBe("managed");
		expect(runState.context.demo_policy).toBe("auto");
		expect(JSON.parse(runState.context.factory_mode_source)).toEqual([
			{
				source: "factory.config.json#kind_id",
				mode: "managed",
				precedence: "high",
				detail: "managed_overlay=kind_id",
			},
		]);
	});
});
