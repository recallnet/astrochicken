import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

const EXAMPLE_TRADING_DOMAIN_GRAPH = resolve(REPO_ROOT, "docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot");

const REMOVED_EXAMPLE_TRADING_WAVE_GRAPHS = [
	"factories/example-trading/graphs/wave_execute.dot",
	"factories/example-trading/graphs/wave_issue_execute.dot",
	"factories/example-trading/graphs/milestone_execute.dot",
	"factories/example-trading/graphs/milestone_execute_parallel_item.dot",
] as const;

const SHARED_GOAL_EXECUTE_TEMPLATE = "@hatch/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs";
const FORBIDDEN_WAVE_DISPATCH_TEMPLATE = "docs/contracts/workflow-ir/capability-wave-dispatch/wave_dispatch.dot";

const FORBIDDEN_LOCAL_DELIVERY_PATHS = [
	"factories/example-trading/graphs/delivery.dot",
	"factories/example-trading/graphs/goal_execute.dot",
	"factories/example-trading/graphs/goal_issue_execute.dot",
	"factories/mothership/replay/delivery.dot",
] as const;

const FORBIDDEN_ACTIVE_PATH_REFERENCES = [
	"@hatch/capability-wave-dispatch/workflows/wave_dispatch/wave_dispatch.workflow-source.mjs",
	"packages/capability-wave-dispatch/workflows/wave_dispatch/wave_dispatch.workflow-source.mjs",
	"factories/example-trading/graphs/wave_dispatch.dot",
	"factories/example-trading/graphs/wave_execute.dot",
	"factories/example-trading/graphs/wave_issue_execute.dot",
	"factories/example-trading/graphs/milestone_execute.dot",
	"factories/example-trading/graphs/milestone_execute_parallel_item.dot",
	...FORBIDDEN_LOCAL_DELIVERY_PATHS,
	"hatch-ops wave ",
	"hatch-ops milestone run --op execute",
] as const;

describe("factory migration contract: @hatch/capability-software-development", () => {
	it("example-trading wave-era active-path graphs are deleted", () => {
		for (const relativePath of REMOVED_EXAMPLE_TRADING_WAVE_GRAPHS) {
			expect(existsSync(resolve(REPO_ROOT, relativePath)), `deleted graph reintroduced: ${relativePath}`).toBe(false);
		}
	});

	it("example-trading does not define local delivery graph surfaces outside capability package", () => {
		for (const relativePath of FORBIDDEN_LOCAL_DELIVERY_PATHS) {
			expect(existsSync(resolve(REPO_ROOT, relativePath)), `forbidden local delivery graph surface: ${relativePath}`).toBe(false);
		}
	});

	it("example-trading domain graph dispatches executable goals through shared goal_execute capability", () => {
		const content = readFileSync(EXAMPLE_TRADING_DOMAIN_GRAPH, "utf8");
		expect(
			content.includes(`template="${SHARED_GOAL_EXECUTE_TEMPLATE}"`),
			`docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot must use ${SHARED_GOAL_EXECUTE_TEMPLATE}`,
		).toBe(true);
		expect(
			content.includes("goal_execute_gate -> spawn_goal_execute [condition=\"count!=0\"]"),
			"docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot must route executable goals to spawn_goal_execute",
		).toBe(true);
	});

	it("example-trading domain graph active path does not reintroduce local wave templates or wave-era commands", () => {
		const content = readFileSync(EXAMPLE_TRADING_DOMAIN_GRAPH, "utf8");
		expect(
			content.includes(FORBIDDEN_WAVE_DISPATCH_TEMPLATE),
			`forbidden template reference in docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot: ${FORBIDDEN_WAVE_DISPATCH_TEMPLATE}`,
		).toBe(false);
		for (const forbidden of FORBIDDEN_ACTIVE_PATH_REFERENCES) {
			expect(
				content.includes(forbidden),
				`forbidden example-trading wave-era reference in docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot: ${forbidden}`,
			).toBe(false);
		}
	});
});
