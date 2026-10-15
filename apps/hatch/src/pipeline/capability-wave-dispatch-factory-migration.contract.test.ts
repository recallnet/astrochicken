import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

const EXAMPLE_TRADING_LOCAL_COPY = resolve(REPO_ROOT, "factories/example-trading/graphs/wave_dispatch.dot");
const EXAMPLE_TRADING_SUPERVISOR_TICK = resolve(REPO_ROOT, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");
const CAPABILITY_GRAPH = resolve(REPO_ROOT, "docs/contracts/workflow-ir/capability-wave-dispatch/wave_dispatch.dot");

const PACKAGE_TEMPLATE = "docs/contracts/workflow-ir/capability-wave-dispatch/wave_dispatch.dot";
const RL_LOCAL_TEMPLATE = "factories/example-trading/graphs/wave_dispatch.dot";

describe("factory migration contract: @hatch/capability-wave-dispatch", () => {
	it("factories/example-trading/graphs/wave_dispatch.dot does not exist (deleted after migration)", () => {
		expect(
			existsSync(EXAMPLE_TRADING_LOCAL_COPY),
			"local copy not deleted: factories/example-trading/graphs/wave_dispatch.dot",
		).toBe(false);
	});

	it("example-trading factory_supervisor_tick.dot does not reference wave-dispatch templates", () => {
		const content = readFileSync(EXAMPLE_TRADING_SUPERVISOR_TICK, "utf8");
		expect(
			content.includes(PACKAGE_TEMPLATE),
			"example-trading supervisor must not depend on docs/contracts/workflow-ir/capability-wave-dispatch/wave_dispatch.dot",
		).toBe(false);
		expect(
			content.includes(RL_LOCAL_TEMPLATE),
			"local example-trading template reference still present in docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot",
		).toBe(false);
	});

	it("capability graph uses parameterized trust/factory placeholders and no example-trading literals", () => {
		const capabilityGraph = readFileSync(CAPABILITY_GRAPH, "utf8");

		expect(capabilityGraph.includes("${trust_domain}")).toBe(true);
		expect(capabilityGraph.includes("${trust_role}")).toBe(true);
		expect(capabilityGraph.includes("${factory_root}")).toBe(true);
		expect(capabilityGraph.includes("${factory_id}")).toBe(true);

		expect(capabilityGraph.includes("example-trading.local")).toBe(false);
		expect(capabilityGraph.includes("--factory-id example-trading")).toBe(false);
		expect(capabilityGraph.includes("factories/example-trading")).toBe(false);
	});

	it("capability graph preserves core dispatch flow nodes", () => {
		const capabilityGraph = readFileSync(CAPABILITY_GRAPH, "utf8");
		for (const nodeId of [
			"acquire_dispatch_lease",
			"ensure_labels",
			"sanitize_state",
			"decide",
			"create_ready",
			"release_dispatch_lease",
		]) {
			expect(
				capabilityGraph.includes(nodeId),
				`missing expected dispatch flow node in capability graph: ${nodeId}`,
			).toBe(true);
		}
	});
});
