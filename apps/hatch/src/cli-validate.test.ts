import { describe, expect, it } from "vitest";

import { parseValidateCommandArgs, VALIDATE_USAGE } from "./cli-validate.js";

describe("parseValidateCommandArgs", () => {
	it("defaults validation mode to legacy when omitted", () => {
		const result = parseValidateCommandArgs(["pipeline.dot"]);
		expect(result).toEqual({ ok: true, file: "pipeline.dot", validationMode: "legacy" });
	});

	it("accepts explicit strict mode flags", () => {
		expect(parseValidateCommandArgs(["--validation-mode", "strict", "pipeline.dot"])).toEqual({
			ok: true,
			file: "pipeline.dot",
			validationMode: "strict",
		});

		expect(parseValidateCommandArgs(["--mode=strict", "pipeline.dot"])).toEqual({
			ok: true,
			file: "pipeline.dot",
			validationMode: "strict",
		});
	});

	it("rejects unknown validation modes", () => {
		const result = parseValidateCommandArgs(["--validation-mode", "future", "pipeline.dot"]);
		expect(result).toEqual({
			ok: false,
			error: 'invalid validation mode "future" (expected: legacy, strict)',
			includeUsage: false,
		});
	});

	it("rejects unknown validate flags", () => {
		const result = parseValidateCommandArgs(["--bogus", "pipeline.dot"]);
		expect(result).toEqual({
			ok: false,
			error: "unknown validate flag: --bogus",
			includeUsage: true,
		});
	});

	it("requires exactly one file argument", () => {
		expect(parseValidateCommandArgs([])).toEqual({
			ok: false,
			error: VALIDATE_USAGE,
			includeUsage: false,
		});

		expect(parseValidateCommandArgs(["a.dot", "b.dot"])).toEqual({
			ok: false,
			error: VALIDATE_USAGE,
			includeUsage: false,
		});
	});
});
