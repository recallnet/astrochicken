import { describe, expect, it, vi } from "vitest";

const { buildStateSnapshotMock, processActionItemsMock } = vi.hoisted(() => ({
	buildStateSnapshotMock: vi.fn(),
	processActionItemsMock: vi.fn(),
}));

vi.mock("../../../../packages/factory-runtime/src/in-process-action-owners.mjs", async () => {
	const actual = await vi.importActual<typeof import("../../../../packages/factory-runtime/src/in-process-action-owners.mjs")>(
		"../../../../packages/factory-runtime/src/in-process-action-owners.mjs",
	);
	return {
		...actual,
		buildStateSnapshot: buildStateSnapshotMock,
		processActionItems: processActionItemsMock,
	};
});

import { ActionRegistry } from "./action-registry.js";
import { Context } from "./context.js";
import { registerSupervisorActions } from "./action-registry-supervisor.js";

import type { ActionExecutionRequest } from "./action-registry.js";
import type { Node } from "./graph.js";

function makeRequest(attrs: Record<string, string> = {}): ActionExecutionRequest {
	return {
		signal: AbortSignal.timeout(5000),
		node: { id: "action_item_gate", attrs } as Node,
		ctx: new Context(),
		input: "",
		workDir: ".",
		env: {},
	};
}

describe("supervisor.action_item_gate", () => {
	it("counts action items without auto-processing them", async () => {
		buildStateSnapshotMock.mockReturnValue(JSON.stringify({
			action_items: [{ id: "one" }, { id: "two" }],
		}));
		processActionItemsMock.mockImplementation(() => {
			throw new Error("should not be called");
		});

		const registry = new ActionRegistry();
		registerSupervisorActions(registry);
		const action = registry.get("supervisor.action_item_gate");

		expect(action).toBeDefined();
		const result = await action!.execute(makeRequest({
			action_repo: "recallnet/astrochicken",
			action_factory_id: "mothership",
			action_target_repo: "recallnet/astrochicken",
			action_control_plane_repo: "recallnet/astrochicken",
			action_runs_dir: ".hatch/mothership/runs",
		}));

		expect(JSON.parse(String(result.output))).toEqual({
			has_action_items: "true",
			action_item_count: 2,
		});
		expect(processActionItemsMock).not.toHaveBeenCalled();
	});
});
