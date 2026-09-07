import { describe, expect, it } from "vitest";

import {
	FACTORY_MODES,
	FACTORY_MODE_CONFLICT_ERROR_CODE,
	MODE_SOURCE_PRECEDENCE,
	ModeConflictError,
	deriveModeFromConfig,
	resolveModeSources,
} from "./mode.js";

describe("factory mode resolution", () => {
	it("exports deterministic mode constants", () => {
		expect(FACTORY_MODES).toEqual(["standalone", "managed"]);
		expect(MODE_SOURCE_PRECEDENCE).toEqual(["high", "medium", "low"]);
		expect(FACTORY_MODE_CONFLICT_ERROR_CODE).toBe("FACTORY_MODE_CONFLICT");
	});

	it("derives standalone mode when no managed signals exist", () => {
		const resolution = deriveModeFromConfig({
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
		});

		expect(resolution.mode).toBe("standalone");
		expect(resolution.source).toEqual([
			{
				source: "factory.config.json#default",
				mode: "standalone",
				precedence: "low",
				detail: "no managed overlays detected",
			},
		]);
	});

	it("derives managed mode from checked-in overlays", () => {
		const resolution = deriveModeFromConfig({
			factory_id: "brainstorm",
			kind_id: "brainstorm",
			target_repo: "example-org/brainstorm",
			control_plane_repo: "recallnet/astrochicken",
		});

		expect(resolution.mode).toBe("managed");
		expect(resolution.source.some((entry) => entry.source === "factory.config.json#kind_id")).toBe(true);
	});

	it("fails closed on conflicting high-precedence signals", () => {
		try {
			deriveModeFromConfig({
				factory_id: "brainstorm",
				managed: false,
				kind_id: "brainstorm",
			});
			expect.fail("expected deriveModeFromConfig to throw ModeConflictError");
		} catch (error) {
			expect(error).toBeInstanceOf(ModeConflictError);
			expect((error as ModeConflictError).code).toBe(FACTORY_MODE_CONFLICT_ERROR_CODE);
			expect(String((error as ModeConflictError).message)).toContain("conflicting mode signals");
		}
	});

	it("resolves mode from context artifacts with deterministic provenance", () => {
		const resolution = resolveModeSources({
			factoryConfig: { factory_id: "brainstorm", target_repo: "example-org/brainstorm" },
			instanceManifest: {
				instance_id: "fac_01",
				kind_id: "brainstorm",
				target_repo: { full_name: "example-org/brainstorm" },
				control_plane_repo: "recallnet/astrochicken",
			},
			instanceManifestPath: "/tmp/.hatch/instance.json",
		});

		expect(resolution.mode).toBe("managed");
		expect(resolution.source.some((entry) => entry.source.includes("instance.json#kind_id"))).toBe(true);
	});
});
