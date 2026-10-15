import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	HarnessFailure,
	asHarnessFailure,
	defaultCommandRunner,
	formatCommand,
	isPathWithin,
	isPlainObject,
	joinPath,
	parseJson,
	resolveCommandInvocation,
	resolveSupervisorGraphPath,
} from "./conformance-support.js";

const repoRootForTests = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

describe("conformance support", () => {
	it("formats shell commands with quoted spaced args", () => {
		expect(formatCommand("pnpm", ["test", "file with spaces"])).toBe('pnpm test "file with spaces"');
	});

	it("parses direct and trailing JSON payloads", () => {
		expect(parseJson('{"ok":true}')).toEqual({ ok: true, value: { ok: true } });
		expect(parseJson("noise\n{\"ok\":true}")).toEqual({ ok: true, value: { ok: true } });
		expect(parseJson("")).toEqual({ ok: false });
	});

	it("detects plain objects only", () => {
		expect(isPlainObject({ ok: true })).toBe(true);
		expect(isPlainObject([])).toBe(false);
		expect(isPlainObject(null)).toBe(false);
	});

	it("resolves supervisor graph paths from factory-relative inputs", () => {
		const root = mkdtempSync(path.join(tmpdir(), "conformance-support-"));
		const repoRoot = path.join(root, "repo");
		const factoryRoot = path.join(repoRoot, "factories", "fixture");
		mkdirSync(path.join(factoryRoot, "graphs"), { recursive: true });
		const graphPath = path.join(factoryRoot, "graphs", "factory_supervisor_tick.dot");
		writeFileSync(graphPath, "digraph x { start -> done }\n");

		expect(resolveSupervisorGraphPath({
			supervisorTickPath: "graphs/factory_supervisor_tick.dot",
			repoRoot,
			factoryRoot,
			factoryConfigPath: path.join(factoryRoot, "factory.config.json"),
		})).toBe(graphPath);
	});

	it("wraps generic errors as HarnessFailure", () => {
		const wrapped = asHarnessFailure(new Error("boom"));
		expect(wrapped).toBeInstanceOf(HarnessFailure);
		expect(wrapped.message).toBe("boom");
	});

	it("runs commands deterministically", () => {
		const result = defaultCommandRunner({
			command: process.execPath,
			args: ["-e", "console.log(JSON.stringify({ok:true}))"],
			cwd: process.cwd(),
			env: process.env,
			timeoutMs: 10_000,
		});

		expect(result.ok).toBe(true);
		expect(result.stdout.trim()).toBe('{"ok":true}');
		expect(result.command).toContain(process.execPath);
	});

	it("resolves local wrapper command invocations and path helpers", () => {
		const root = mkdtempSync(path.join(tmpdir(), "conformance-support-cmd-"));
		const localBinDir = path.join(root, "node_modules", ".bin");
		mkdirSync(localBinDir, { recursive: true });
		writeFileSync(path.join(localBinDir, "demo"), "#!/bin/sh\n");

		const local = resolveCommandInvocation("demo", root);
		expect(local.command).toBe(path.join(localBinDir, "demo"));
		expect(local.displayCommand).toBe("demo");

		const hatchOps = resolveCommandInvocation("hatch-ops", repoRootForTests);
		expect(hatchOps.displayCommand).toBe("hatch-ops");
		expect(
			hatchOps.command === process.execPath
			|| hatchOps.command.endsWith("/node_modules/.bin/hatch-ops"),
		).toBe(true);
		if (hatchOps.command === process.execPath) {
			expect(hatchOps.argsPrefix[0]).toMatch(/packages\/factory-ops\/src\/cli\.ts$/);
		}

		expect(joinPath("a", "b", "c")).toBe(path.join("a", "b", "c"));
		expect(isPathWithin("/tmp/example", "/tmp/example/file.txt")).toBe(true);
		expect(isPathWithin("/tmp/example", "/tmp/other/file.txt")).toBe(false);
	});
});
