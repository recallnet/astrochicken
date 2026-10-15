import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

const MIGRATED_GRAPHS = [
	"goal_queue.dot",
	"goal_run.dot",
	"goal_batch.dot",
	"goal_factory.dot",
	"goal_intake_decompose.dot",
	"write_issues.dot",
	"write_issue_item.dot",
] as const;

const MOTHERSHIP_GRAPHS_DIR = resolve(REPO_ROOT, "factories/mothership/graphs");
const EXAMPLE_TRADING_GRAPHS_DIR = resolve(REPO_ROOT, "factories/example-trading/graphs");
const MOTHERSHIP_SUPERVISOR_TICK = resolve(REPO_ROOT, "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");
const EXAMPLE_TRADING_DOMAIN_GRAPH = resolve(REPO_ROOT, "docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot");

const PACKAGE_GOAL_RUN = "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs";
const MS_LOCAL_GOAL_RUN = "factories/mothership/graphs/goal_run.dot";
const RL_LOCAL_GOAL_RUN = "factories/example-trading/graphs/goal_run.dot";

const PARAMETERIZED_GOAL_ANALYZER = "${capability_goal_decomposition_skills}/goal_analyzer/current.md";
const PARAMETERIZED_ISSUE_WRITER = "${capability_goal_decomposition_skills}/issue_writer/current.md";
const MS_HARDCODED_GOAL_ANALYZER = "factories/mothership/skills/goal_analyzer/current.md";
const RL_HARDCODED_GOAL_ANALYZER = "factories/example-trading/skills/goal_analyzer/current.md";
const MS_HARDCODED_ISSUE_WRITER = "factories/mothership/skills/issue_writer/current.md";
const RL_HARDCODED_ISSUE_WRITER = "factories/example-trading/skills/issue_writer/current.md";

const PACKAGE_GOAL_INTAKE_DECOMPOSE = resolve(REPO_ROOT, "docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot");
const PACKAGE_WRITE_ISSUE_ITEM = resolve(REPO_ROOT, "docs/contracts/workflow-ir/capability-goal-decomposition/write_issue_item.dot");

function listDotFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".dot"))
		.map((entry) => join(dir, entry.name));
}

describe("factory migration contract: @hatch/capability-goal-decomposition", () => {
	it("all capability-owned decomposition graph files are absent from factories/mothership/graphs/", () => {
		for (const graph of MIGRATED_GRAPHS) {
			expect(
				existsSync(join(MOTHERSHIP_GRAPHS_DIR, graph)),
				`local copy not deleted: factories/mothership/graphs/${graph}`,
			).toBe(false);
		}
	});

	it("all capability-owned decomposition graph files are absent from factories/example-trading/graphs/", () => {
		for (const graph of MIGRATED_GRAPHS) {
			expect(
				existsSync(join(EXAMPLE_TRADING_GRAPHS_DIR, graph)),
				`local copy not deleted: factories/example-trading/graphs/${graph}`,
			).toBe(false);
		}
	});

	it("example-trading domain graph references package goal_run and not legacy local goal_run paths", () => {
		const mothershipContent = readFileSync(MOTHERSHIP_SUPERVISOR_TICK, "utf8");
		const replayLabContent = readFileSync(EXAMPLE_TRADING_DOMAIN_GRAPH, "utf8");

		expect(mothershipContent.includes(PACKAGE_GOAL_RUN)).toBe(true);
		expect(replayLabContent.includes(PACKAGE_GOAL_RUN.replace("packages/", "@hatch/"))).toBe(true);

		expect(mothershipContent.includes(MS_LOCAL_GOAL_RUN)).toBe(false);
		expect(mothershipContent.includes(RL_LOCAL_GOAL_RUN)).toBe(false);
		expect(replayLabContent.includes(MS_LOCAL_GOAL_RUN)).toBe(false);
		expect(replayLabContent.includes(RL_LOCAL_GOAL_RUN)).toBe(false);
	});

	it("example-trading domain graph includes capability_goal_decomposition_skills context injection", () => {
		const mothershipContent = readFileSync(MOTHERSHIP_SUPERVISOR_TICK, "utf8");
		const replayLabContent = readFileSync(EXAMPLE_TRADING_DOMAIN_GRAPH, "utf8");

		expect(mothershipContent.includes("capability_goal_decomposition_skills")).toBe(true);
		expect(replayLabContent.includes("capability_goal_decomposition_skills")).toBe(true);
	});

	it("no graph remaining in factories/mothership/graphs/ contains hardcoded mothership goal_analyzer skill path", () => {
		for (const dotPath of listDotFiles(resolve(REPO_ROOT, "docs/contracts/workflow-ir/mothership"))) {
			const content = readFileSync(dotPath, "utf8");
			expect(content.includes(MS_HARDCODED_GOAL_ANALYZER), `hardcoded path in ${dotPath}`).toBe(false);
		}
	});

	it("no graph remaining in factories/example-trading/graphs/ contains hardcoded example-trading goal_analyzer skill path", () => {
		for (const dotPath of listDotFiles(resolve(REPO_ROOT, "docs/contracts/workflow-ir/factory-runtime"))) {
			const content = readFileSync(dotPath, "utf8");
			expect(content.includes(RL_HARDCODED_GOAL_ANALYZER), `hardcoded path in ${dotPath}`).toBe(false);
		}
	});

	it("no graph remaining in factories/mothership/graphs/ contains hardcoded mothership issue_writer skill path", () => {
		for (const dotPath of listDotFiles(resolve(REPO_ROOT, "docs/contracts/workflow-ir/mothership"))) {
			const content = readFileSync(dotPath, "utf8");
			expect(content.includes(MS_HARDCODED_ISSUE_WRITER), `hardcoded path in ${dotPath}`).toBe(false);
		}
	});

	it("no graph remaining in factories/example-trading/graphs/ contains hardcoded example-trading issue_writer skill path", () => {
		for (const dotPath of listDotFiles(resolve(REPO_ROOT, "docs/contracts/workflow-ir/factory-runtime"))) {
			const content = readFileSync(dotPath, "utf8");
			expect(content.includes(RL_HARDCODED_ISSUE_WRITER), `hardcoded path in ${dotPath}`).toBe(false);
		}
	});

	it("package graphs use parameterized ${capability_goal_decomposition_skills} for goal_analyzer", () => {
		const content = readFileSync(PACKAGE_GOAL_INTAKE_DECOMPOSE, "utf8");
		expect(content.includes(PARAMETERIZED_GOAL_ANALYZER)).toBe(true);
		expect(content.includes(MS_HARDCODED_GOAL_ANALYZER)).toBe(false);
		expect(content.includes(RL_HARDCODED_GOAL_ANALYZER)).toBe(false);
	});

	it("package graphs use parameterized ${capability_goal_decomposition_skills} for issue_writer", () => {
		const content = readFileSync(PACKAGE_WRITE_ISSUE_ITEM, "utf8");
		expect(content.includes(PARAMETERIZED_ISSUE_WRITER)).toBe(true);
		expect(content.includes(MS_HARDCODED_ISSUE_WRITER)).toBe(false);
		expect(content.includes(RL_HARDCODED_ISSUE_WRITER)).toBe(false);
	});
});
