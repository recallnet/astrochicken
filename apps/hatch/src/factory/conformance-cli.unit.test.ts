import { describe, expect, it } from "vitest";

import { runFactoryConformanceCommand } from "./conformance-cli.js";

function createStreamCapture() {
	let value = "";
	return {
		stream: {
			write(chunk: string) {
				value += String(chunk);
				return true;
			},
		} as unknown as NodeJS.WriteStream,
		read() {
			return value;
		},
	};
}

describe("runFactoryConformanceCommand", () => {
	it("prints help for --help", async () => {
		const stdoutCapture = createStreamCapture();
		const stderrCapture = createStreamCapture();
		const code = await runFactoryConformanceCommand(["--help"], {
			cwd: process.cwd(),
			stdout: stdoutCapture.stream,
			stderr: stderrCapture.stream,
			runHarness: async () => {
				throw new Error("unexpected harness execution");
			},
		});

		expect(code).toBe(0);
		expect(stdoutCapture.read()).toContain("usage: hatch factory conformance");
		expect(stderrCapture.read()).toBe("");
	});

	it("passes through conformance result and emits telemetry labels", async () => {
		const stdoutCapture = createStreamCapture();
		const stderrCapture = createStreamCapture();
		let called = false;
		const code = await runFactoryConformanceCommand([
			"--factory-root",
			"factories/mothership",
			"--repo-root",
			".",
			"--phase",
			"policy_pack_conformance",
			"--json",
		], {
			cwd: process.cwd(),
			stdout: stdoutCapture.stream,
			stderr: stderrCapture.stream,
			runHarness: async (options) => {
				called = true;
				expect(options.factoryRoot).toContain("factories/mothership");
				expect(options.phases).toEqual(["config_schema", "policy_pack_conformance"]);
				options.onPhaseEvent?.({
					phase: "policy_pack_conformance",
					phase_label: "Policy pack conformance",
					action: "run",
				});
				options.onPhaseEvent?.({
					phase: "policy_pack_conformance",
					phase_label: "Policy pack conformance",
					action: "result",
					ok: true,
					duration_ms: 12,
				});
				return {
					ok: true,
					factory_root: options.factoryRoot,
					repo_root: options.repoRoot || process.cwd(),
					phases: [
						{
							phase: "policy_pack_conformance",
							ok: true,
							duration_ms: 12,
							details: { issue_count: 0 },
						},
					],
					failed_phase: "",
					first_failure: null,
				};
			},
		});

		expect(called).toBe(true);
		expect(code).toBe(0);
		expect(stderrCapture.read()).toContain('factory_conformance phase=policy_pack_conformance action=run label="Policy pack conformance"');
		expect(stderrCapture.read()).toContain('factory_conformance phase=policy_pack_conformance result=ok duration_ms=12 label="Policy pack conformance"');
		expect(stderrCapture.read()).toContain("factory_conformance result=ok failed_phase=");
		expect(JSON.parse(stdoutCapture.read())).toMatchObject({ ok: true, failed_phase: "" });
	});

	it("resolves factory root by walking ancestor directories", async () => {
		const stdoutCapture = createStreamCapture();
		const stderrCapture = createStreamCapture();
		const code = await runFactoryConformanceCommand([
			"--factory-id",
			"mothership",
			"--phase",
			"policy_pack_conformance",
		], {
			cwd: `${process.cwd()}/apps/hatch`,
			stdout: stdoutCapture.stream,
			stderr: stderrCapture.stream,
			runHarness: async (options) => {
				expect(options.factoryRoot).toContain("factories/mothership");
				return {
					ok: true,
					factory_root: options.factoryRoot,
					repo_root: options.repoRoot || process.cwd(),
					phases: [],
					failed_phase: "",
					first_failure: null,
				};
			},
		});

		expect(code).toBe(0);
		expect(stderrCapture.read()).toContain("factory_conformance result=ok failed_phase=");
		expect(stdoutCapture.read()).toBe("");
	});

	it("expands dependent phases for graph_validate selection", async () => {
		const stdoutCapture = createStreamCapture();
		const stderrCapture = createStreamCapture();
		const code = await runFactoryConformanceCommand([
			"--factory-root",
			"factories/mothership",
			"--phase",
			"graph_validate",
		], {
			cwd: process.cwd(),
			stdout: stdoutCapture.stream,
			stderr: stderrCapture.stream,
			runHarness: async (options) => {
				expect(options.phases).toEqual(["config_schema", "policy_pack_conformance", "graph_validate"]);
				return {
					ok: true,
					factory_root: options.factoryRoot,
					repo_root: options.repoRoot || process.cwd(),
					phases: [],
					failed_phase: "",
					first_failure: null,
				};
			},
		});

		expect(code).toBe(0);
		expect(stdoutCapture.read()).toBe("");
		expect(stderrCapture.read()).toContain("factory_conformance result=ok failed_phase=");
	});


	it("expands benchmark_telemetry phase with config_schema dependency", async () => {
		const stdoutCapture = createStreamCapture();
		const stderrCapture = createStreamCapture();
		const code = await runFactoryConformanceCommand([
			"--factory-root",
			"factories/mothership",
			"--phase",
			"benchmark_telemetry",
		], {
			cwd: process.cwd(),
			stdout: stdoutCapture.stream,
			stderr: stderrCapture.stream,
			runHarness: async (options) => {
				expect(options.phases).toEqual(["config_schema", "benchmark_telemetry"]);
				return {
					ok: true,
					factory_root: options.factoryRoot,
					repo_root: options.repoRoot || process.cwd(),
					phases: [],
					failed_phase: "",
					first_failure: null,
				};
			},
		});

		expect(code).toBe(0);
		expect(stdoutCapture.read()).toBe("");
		expect(stderrCapture.read()).toContain("factory_conformance result=ok failed_phase=");
	});

	it("expands intent_stack phase with config_schema dependency", async () => {
		const stdoutCapture = createStreamCapture();
		const stderrCapture = createStreamCapture();
		const code = await runFactoryConformanceCommand([
			"--factory-root",
			"factories/mothership",
			"--phase",
			"intent_stack",
		], {
			cwd: process.cwd(),
			stdout: stdoutCapture.stream,
			stderr: stderrCapture.stream,
			runHarness: async (options) => {
				expect(options.phases).toEqual(["config_schema", "intent_stack"]);
				return {
					ok: true,
					factory_root: options.factoryRoot,
					repo_root: options.repoRoot || process.cwd(),
					phases: [],
					failed_phase: "",
					first_failure: null,
				};
			},
		});

		expect(code).toBe(0);
		expect(stdoutCapture.read()).toBe("");
		expect(stderrCapture.read()).toContain("factory_conformance result=ok failed_phase=");
	});

	it("expands skill_loading phase with config_schema dependency", async () => {
		const stdoutCapture = createStreamCapture();
		const stderrCapture = createStreamCapture();
		const code = await runFactoryConformanceCommand([
			"--factory-root",
			"factories/mothership",
			"--phase",
			"skill_loading",
		], {
			cwd: process.cwd(),
			stdout: stdoutCapture.stream,
			stderr: stderrCapture.stream,
			runHarness: async (options) => {
				expect(options.phases).toEqual(["config_schema", "skill_loading"]);
				return {
					ok: true,
					factory_root: options.factoryRoot,
					repo_root: options.repoRoot || process.cwd(),
					phases: [],
					failed_phase: "",
					first_failure: null,
				};
			},
		});

		expect(code).toBe(0);
		expect(stdoutCapture.read()).toBe("");
		expect(stderrCapture.read()).toContain("factory_conformance result=ok failed_phase=");
	});

	it("expands scenario_root phase with config_schema dependency", async () => {
		const stdoutCapture = createStreamCapture();
		const stderrCapture = createStreamCapture();
		const code = await runFactoryConformanceCommand([
			"--factory-root",
			"factories/mothership",
			"--phase",
			"scenario_root",
		], {
			cwd: process.cwd(),
			stdout: stdoutCapture.stream,
			stderr: stderrCapture.stream,
			runHarness: async (options) => {
				expect(options.phases).toEqual(["config_schema", "scenario_root"]);
				return {
					ok: true,
					factory_root: options.factoryRoot,
					repo_root: options.repoRoot || process.cwd(),
					phases: [],
					failed_phase: "",
					first_failure: null,
				};
			},
		});

		expect(code).toBe(0);
		expect(stdoutCapture.read()).toBe("");
		expect(stderrCapture.read()).toContain("factory_conformance result=ok failed_phase=");
	});

	it("returns usage error for unknown options", async () => {
		const stdoutCapture = createStreamCapture();
		const stderrCapture = createStreamCapture();
		const code = await runFactoryConformanceCommand(["--wat"], {
			cwd: process.cwd(),
			stdout: stdoutCapture.stream,
			stderr: stderrCapture.stream,
			runHarness: async () => {
				throw new Error("unexpected harness execution");
			},
		});

		expect(code).toBe(1);
		expect(stdoutCapture.read()).toBe("");
		expect(stderrCapture.read()).toContain("unknown factory conformance option: --wat");
		expect(stderrCapture.read()).toContain("usage: hatch factory conformance");
	});
});
