import { describe, expect, it } from "vitest";

import { createDefaultActionRegistry } from "./action-registry.js";
import { Context } from "./context.js";

import type { ActionExecutionRequest } from "./action-registry.js";
import type { Node } from "./graph.js";

function makeRequest(overrides: {
	attrs?: Record<string, string>;
	ctx?: Context;
	input?: string;
}): ActionExecutionRequest {
	return {
		signal: AbortSignal.timeout(5000),
		node: { id: "test_node", attrs: overrides.attrs || {} } as Node,
		ctx: overrides.ctx || new Context(),
		input: overrides.input || "",
		workDir: ".",
		env: {},
	};
}

describe("common.resolve_default action", () => {
	const registry = createDefaultActionRegistry();
	const action = registry.get("common.resolve_default")!;

	it("returns action_value when present", async () => {
		const result = await action.execute(makeRequest({
			attrs: { action_value: "explicit_value", action_fallback: "fallback" },
		}));
		expect(result.output).toBe("explicit_value");
	});

	it("returns action_fallback when action_value is empty", async () => {
		const result = await action.execute(makeRequest({
			attrs: { action_value: "", action_fallback: "fallback" },
		}));
		expect(result.output).toBe("fallback");
	});

	it("returns action_fallback when action_value is missing", async () => {
		const result = await action.execute(makeRequest({
			attrs: { action_fallback: "fallback" },
		}));
		expect(result.output).toBe("fallback");
	});

	it("expands context variables in action_value", async () => {
		const ctx = new Context({ my_var: "resolved" });
		const result = await action.execute(makeRequest({
			attrs: { action_value: "${my_var}", action_fallback: "fallback" },
			ctx,
		}));
		expect(result.output).toBe("resolved");
	});

	it("falls back when context variable is missing (expands to empty)", async () => {
		const ctx = new Context();
		const result = await action.execute(makeRequest({
			attrs: { action_value: "${missing_var}", action_fallback: "fallback" },
			ctx,
		}));
		expect(result.output).toBe("fallback");
	});

	it("does NOT use piped input as implicit fallback when action_value is empty", async () => {
		const result = await action.execute(makeRequest({
			attrs: { action_value: "", action_fallback: "20" },
			input: "mothership",
		}));
		expect(result.output).toBe("20");
	});

	it("does NOT use piped input when context variable expands to empty", async () => {
		const ctx = new Context();
		const result = await action.execute(makeRequest({
			attrs: { action_value: "${max_artifacts}", action_fallback: "20" },
			ctx,
			input: "mothership",
		}));
		expect(result.output).toBe("20");
	});
});

describe("common.resolve_boolean action", () => {
	const registry = createDefaultActionRegistry();
	const action = registry.get("common.resolve_boolean")!;

	it("returns expanded boolean when action_value is present", async () => {
		const result = await action.execute(makeRequest({
			attrs: { action_value: "true", action_fallback: "false" },
		}));
		expect(result.output).toBe("true");
	});

	it("returns fallback when action_value is empty", async () => {
		const result = await action.execute(makeRequest({
			attrs: { action_value: "", action_fallback: "true" },
		}));
		expect(result.output).toBe("true");
	});

	it("does NOT use piped input when action_value is empty", async () => {
		const result = await action.execute(makeRequest({
			attrs: { action_value: "", action_fallback: "false" },
			input: "true",
		}));
		expect(result.output).toBe("false");
	});

	it("does NOT use piped input when context variable expands to empty", async () => {
		const ctx = new Context();
		const result = await action.execute(makeRequest({
			attrs: { action_value: "${dry_run}", action_fallback: "false" },
			ctx,
			input: "true",
		}));
		expect(result.output).toBe("false");
	});
});
