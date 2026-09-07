import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	BenchmarkTelemetryPhaseError,
	evaluateBenchmarkTelemetryPhase,
} from "./benchmark-telemetry-phase.js";
import { FACTORY_CONFORMANCE_PHASES, runFactoryConformanceHarness } from "./conformance-harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_REPO_ROOT = path.resolve(__dirname, "../../../../");

function baseFactoryConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: "hatch.factory.config.v1",
		factory_id: "fixture-factory",
		target_repo: "example-org/fixture-factory",
		control_plane_repo: "recallnet/astrochicken",
		dispatch: { graph: "graphs/factory_supervisor_tick.dot" },
		skills: { supervisor: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md" },
		scenarios: { root: "factories/fixture-factory/scenarios/fixture-factory" },
		pipeline: { supervisor_tick: "graphs/factory_supervisor_tick.dot" },
		runs_dir: ".hatch/fixture-factory/runs",
		trust: {
			domain: "fixture-factory.local",
			roles: ["fixture-factory.local.tool"],
		},
		...overrides,
	};
}

function writeFixture(args: {
	graph: string;
	conformance?: Record<string, unknown>;
}): { repoRoot: string; factoryRoot: string; cleanup: () => void } {
	const repoRoot = mkdtempSync(path.join(tmpdir(), "benchmark-telemetry-phase-"));
	const factoryRoot = path.join(repoRoot, "factories", "fixture-factory");
	mkdirSync(path.join(factoryRoot, "graphs"), { recursive: true });
	writeFileSync(path.join(factoryRoot, "graphs", "factory_supervisor_tick.dot"), args.graph);
	writeFileSync(
		path.join(factoryRoot, "factory.config.json"),
		`${JSON.stringify(baseFactoryConfig(args.conformance ? { conformance: args.conformance } : {}), null, 2)}\n`,
	);
	return {
		repoRoot,
		factoryRoot,
		cleanup() {
			rmSync(repoRoot, { recursive: true, force: true });
		},
	};
}

describe("benchmark telemetry conformance phase contract", () => {
	it("registers benchmark_telemetry in canonical phase list", () => {
		expect(FACTORY_CONFORMANCE_PHASES).toContain("benchmark_telemetry");
		expect(BenchmarkTelemetryPhaseError.name).toBe("BenchmarkTelemetryPhaseError");
	});

	it("skips when graphs directory is missing", () => {
		const repoRoot = mkdtempSync(path.join(tmpdir(), "benchmark-telemetry-no-graphs-"));
		const factoryRoot = path.join(repoRoot, "factories", "fixture-factory");
		mkdirSync(factoryRoot, { recursive: true });
		writeFileSync(
			path.join(factoryRoot, "factory.config.json"),
			`${JSON.stringify(baseFactoryConfig(), null, 2)}\n`,
		);

		try {
			const details = evaluateBenchmarkTelemetryPhase({
				factoryRoot,
				repoRoot,
				exemptions: [],
			});
			expect(details.error_count).toBe(0);
			expect(details.graph_count).toBe(0);
			expect(details.skipped).toBe(true);
			expect(details.skip_reason).toBe("no_graphs_dir");
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("fails when an LLM-class node is missing benchmark telemetry attributes", async () => {
		const fixture = writeFixture({
			graph: `digraph factory_supervisor_tick {
	start [shape=Mdiamond]
	build [class="coder" label="Build"]
	done [shape=Msquare]
	start -> build -> done
}
`,
		});
		try {
			const details = evaluateBenchmarkTelemetryPhase({
				factoryRoot: fixture.factoryRoot,
				repoRoot: fixture.repoRoot,
				exemptions: [],
			});
			expect(details.error_count).toBe(1);

			const result = await runFactoryConformanceHarness({
				factoryRoot: fixture.factoryRoot,
				repoRoot: fixture.repoRoot,
				phases: ["benchmark_telemetry"],
			});
			expect(result.ok).toBe(false);
			expect(result.first_failure?.phase).toBe("benchmark_telemetry");
			const phase = result.phases.find((entry) => entry.phase === "benchmark_telemetry");
			expect(phase?.details["error_count"]).toBe(1);
			expect(String(phase?.error || "")).toContain("benchmark_telemetry failed");
		} finally {
			fixture.cleanup();
		}
	});

	it("passes when LLM-class nodes carry benchmark_job_id/prompt_version/role_version/skill_id", async () => {
		const fixture = writeFixture({
			graph: `digraph factory_supervisor_tick {
	start [shape=Mdiamond]
	build [class="coder" benchmark_job_id="fixture.build" prompt_version="2026-03-11.r1" role_version="1.0.0" skill_id="fixture.skill" label="Build"]
	done [shape=Msquare]
	start -> build -> done
}
`,
		});
		try {
			const result = await runFactoryConformanceHarness({
				factoryRoot: fixture.factoryRoot,
				repoRoot: fixture.repoRoot,
				phases: ["benchmark_telemetry"],
			});
			expect(result.ok).toBe(true);
			const phase = result.phases.find((entry) => entry.phase === "benchmark_telemetry");
			expect(phase?.details["error_count"]).toBe(0);
		} finally {
			fixture.cleanup();
		}
	});

	it("honors conformance.benchmark_telemetry_exemptions", async () => {
		const fixture = writeFixture({
			graph: `digraph factory_supervisor_tick {
	start [shape=Mdiamond]
	build [class="coder" label="Build"]
	done [shape=Msquare]
	start -> build -> done
}
`,
			conformance: {
				entrypoint: "factories/fixture-factory/scripts/run-conformance.sh",
				benchmark_telemetry_exemptions: ["build"],
			},
		});
		try {
			const result = await runFactoryConformanceHarness({
				factoryRoot: fixture.factoryRoot,
				repoRoot: fixture.repoRoot,
				phases: ["benchmark_telemetry"],
			});
			expect(result.ok).toBe(true);
			const phase = result.phases.find((entry) => entry.phase === "benchmark_telemetry");
			expect(phase?.details["exempted_node_count"]).toBe(1);
		} finally {
			fixture.cleanup();
		}
	});

	it("downgrades violations to warnings when benchmark_telemetry_warn_only=true", async () => {
		const fixture = writeFixture({
			graph: `digraph factory_supervisor_tick {
	start [shape=Mdiamond]
	build [class="coder" label="Build"]
	done [shape=Msquare]
	start -> build -> done
}
`,
			conformance: {
				entrypoint: "factories/fixture-factory/scripts/run-conformance.sh",
				benchmark_telemetry_warn_only: true,
			},
		});
		try {
			const result = await runFactoryConformanceHarness({
				factoryRoot: fixture.factoryRoot,
				repoRoot: fixture.repoRoot,
				phases: ["benchmark_telemetry"],
			});
			expect(result.ok).toBe(true);
			const phase = result.phases.find((entry) => entry.phase === "benchmark_telemetry");
			expect(phase?.details["warned"]).toBe(true);
			expect(Array.isArray(phase?.details["warnings"])).toBe(true);
		} finally {
			fixture.cleanup();
		}
	});

	it("passes benchmark_telemetry for shipped external factory scaffold example", async () => {
		const result = await runFactoryConformanceHarness({
			factoryRoot: path.join(REAL_REPO_ROOT, "examples/external-factories/acme-support"),
			repoRoot: REAL_REPO_ROOT,
			phases: ["benchmark_telemetry"],
		});
		expect(result.ok).toBe(true);
	});

	describe("dual-context telemetry identity", () => {
		it("evaluates mothership and external-factory factory_id without telemetry violations", () => {
			const mothership = evaluateBenchmarkTelemetryPhase({
				factoryRoot: path.join(REAL_REPO_ROOT, "factories/mothership"),
				repoRoot: REAL_REPO_ROOT,
				exemptions: [],
			});
			expect(mothership.factory_id).toBe("mothership");
			expect(mothership.error_count).toBe(0);

			const acmeSupport = evaluateBenchmarkTelemetryPhase({
				factoryRoot: path.join(REAL_REPO_ROOT, "examples/external-factories/acme-support"),
				repoRoot: REAL_REPO_ROOT,
				exemptions: [],
			});
			expect(acmeSupport.factory_id).toBe("acme-support");
			expect(acmeSupport.error_count).toBe(0);
		});
	});

	it("scaffold template includes benchmark_job_id stub", () => {
		const templatePath = path.join(
			REAL_REPO_ROOT,
			"factories/_templates/factory/graphs/factory_supervisor_tick.dot.template",
		);
		const template = readFileSync(templatePath, "utf8");
		expect(template).toContain("benchmark_job_id");
	});
});
