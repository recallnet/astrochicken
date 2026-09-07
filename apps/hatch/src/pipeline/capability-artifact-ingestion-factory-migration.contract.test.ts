import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

const MOTHERSHIP_LOCAL_COPY = resolve(REPO_ROOT, "factories/mothership/graphs/artifact_ingest.dot");
const EXAMPLE_TRADING_LOCAL_COPY = resolve(REPO_ROOT, "factories/example-trading/graphs/artifact_ingest.dot");

const MOTHERSHIP_DISPATCH_REACTOR = resolve(REPO_ROOT, "factories/mothership/graphs/factory_dispatch_reactor.dot");
const EXAMPLE_TRADING_DOMAIN_GRAPH = resolve(REPO_ROOT, "factories/example-trading/graphs/domain_example_trading.dot");

const PACKAGE_TEMPLATE = "docs/contracts/workflow-ir/capability-artifact-ingestion/artifact_ingest.dot";
const MS_LOCAL_TEMPLATE = "factories/mothership/graphs/artifact_ingest.dot";
const RL_LOCAL_TEMPLATE = "factories/example-trading/graphs/artifact_ingest.dot";

describe("factory migration contract: @hatch/capability-artifact-ingestion", () => {
	it("factories/mothership/graphs/artifact_ingest.dot does not exist (deleted after migration)", () => {
		expect(
			existsSync(MOTHERSHIP_LOCAL_COPY),
			"local copy not deleted: factories/mothership/graphs/artifact_ingest.dot",
		).toBe(false);
	});

	it("factories/example-trading/graphs/artifact_ingest.dot does not exist (deleted after migration)", () => {
		expect(
			existsSync(EXAMPLE_TRADING_LOCAL_COPY),
			"local copy not deleted: factories/example-trading/graphs/artifact_ingest.dot",
		).toBe(false);
	});

	it("mothership factory_dispatch_reactor.dot references package template and not local template", () => {
		const content = readFileSync(MOTHERSHIP_DISPATCH_REACTOR, "utf8");
		expect(
			content.includes(PACKAGE_TEMPLATE),
			"missing package template reference in factories/mothership/graphs/factory_dispatch_reactor.dot",
		).toBe(true);
		expect(
			content.includes(MS_LOCAL_TEMPLATE),
			"local mothership template reference still present in factories/mothership/graphs/factory_dispatch_reactor.dot",
		).toBe(false);
	});

	it("example-trading domain_example_trading.dot references package template and not local template", () => {
		const content = readFileSync(EXAMPLE_TRADING_DOMAIN_GRAPH, "utf8");
		expect(
			content.includes(PACKAGE_TEMPLATE),
			"missing package template reference in factories/example-trading/graphs/domain_example_trading.dot",
		).toBe(true);
		expect(
			content.includes(RL_LOCAL_TEMPLATE),
			"local example-trading template reference still present in factories/example-trading/graphs/domain_example_trading.dot",
		).toBe(false);
	});

	it("capability graph uses parameterized trust_domain and trust_role (not hardcoded factory values)", () => {
		const capabilityGraph = readFileSync(
			resolve(REPO_ROOT, "docs/contracts/workflow-ir/capability-artifact-ingestion/artifact_ingest.dot"),
			"utf8",
		);
		expect(capabilityGraph.includes("${trust_domain}")).toBe(true);
		expect(capabilityGraph.includes("${trust_role}")).toBe(true);
		expect(capabilityGraph.includes("mothership.local")).toBe(false);
		expect(capabilityGraph.includes("example-trading.local")).toBe(false);
	});
});
