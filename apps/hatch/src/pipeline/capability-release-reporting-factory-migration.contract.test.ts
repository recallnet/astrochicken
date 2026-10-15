import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

const MOTHERSHIP_LOCAL_COPY = resolve(REPO_ROOT, "factories/mothership/graphs/release_report_flow.dot");
const EXAMPLE_TRADING_LOCAL_COPY = resolve(REPO_ROOT, "factories/example-trading/graphs/release_report_flow.dot");

const MOTHERSHIP_SUPERVISOR_TICK = resolve(REPO_ROOT, "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");
const EXAMPLE_TRADING_DOMAIN_GRAPH = resolve(REPO_ROOT, "docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot");
const MOTHERSHIP_DAILY_RELEASE = resolve(REPO_ROOT, "factories/mothership/graphs/daily_release_report.dot");
const EXAMPLE_TRADING_CONFIG = resolve(REPO_ROOT, "factories/example-trading/factory.config.json");

const PACKAGE_TEMPLATE = "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs";
const MS_LOCAL_TEMPLATE = "factories/mothership/graphs/release_report_flow.dot";
const RL_LOCAL_TEMPLATE = "factories/example-trading/graphs/release_report_flow.dot";

describe("factory migration contract: @hatch/capability-release-reporting", () => {
	it("factories/mothership/graphs/release_report_flow.dot does not exist (deleted after migration)", () => {
		expect(
			existsSync(MOTHERSHIP_LOCAL_COPY),
			"local copy not deleted: factories/mothership/graphs/release_report_flow.dot",
		).toBe(false);
	});

	it("factories/example-trading/graphs/release_report_flow.dot does not exist (deleted after migration)", () => {
		expect(
			existsSync(EXAMPLE_TRADING_LOCAL_COPY),
			"local copy not deleted: factories/example-trading/graphs/release_report_flow.dot",
		).toBe(false);
	});

	it("supervisor tick graphs no longer embed release report flow inline", () => {
		const mothershipTick = readFileSync(MOTHERSHIP_SUPERVISOR_TICK, "utf8");
		expect(
			mothershipTick.includes(PACKAGE_TEMPLATE),
			"mothership supervisor tick must not reference release_report_flow (moved to daily scheduled job)",
		).toBe(false);
		expect(
			mothershipTick.includes(MS_LOCAL_TEMPLATE),
			"mothership supervisor tick must not reference local release_report_flow",
		).toBe(false);

		const example_tradingdomain = readFileSync(EXAMPLE_TRADING_DOMAIN_GRAPH, "utf8");
		expect(
			example_tradingdomain.includes(PACKAGE_TEMPLATE),
			"example-trading domain graph must not reference release_report_flow (moved to daily scheduled job)",
		).toBe(false);
		expect(
			example_tradingdomain.includes(RL_LOCAL_TEMPLATE),
			"example-trading domain graph must not reference local release_report_flow",
		).toBe(false);
	});

	it("daily scheduled release report graphs reference package template", () => {
		const mothershipDaily = readFileSync(MOTHERSHIP_DAILY_RELEASE, "utf8");
		expect(
			mothershipDaily.includes(PACKAGE_TEMPLATE),
			"mothership daily_release_report.dot must reference package template",
		).toBe(true);

		const exampleTradingConfig = JSON.parse(readFileSync(EXAMPLE_TRADING_CONFIG, "utf8"));
		const releaseJob = exampleTradingConfig.schedules.jobs.find((job: { id: string }) => job.id === "daily-release-report");
		expect(
			releaseJob?.graph === PACKAGE_TEMPLATE,
			"example-trading daily_release_report.dot must reference package template",
		).toBe(true);
	});

	it("capability graph uses parameterized trust_domain and trust_role (not hardcoded factory values)", () => {
		const capabilityGraph = readFileSync(
			resolve(REPO_ROOT, "docs/contracts/workflow-ir/capability-release-reporting/release_report_flow.dot"),
			"utf8",
		);
		expect(capabilityGraph.includes("${trust_domain}")).toBe(true);
		expect(capabilityGraph.includes("${trust_role}")).toBe(true);
		expect(capabilityGraph.includes("mothership.local")).toBe(false);
		expect(capabilityGraph.includes("example-trading.local")).toBe(false);
	});
});
