import { StageStatus, type Context, type Outcome } from "./context.js";
import { expandVariables } from "./engine.js";
import type { Node } from "./graph.js";
import type { ActionExecutionRequest, ActionExecutor, ActionRegistry } from "./action-registry.js";
// @ts-ignore JS-owned software-development capability action owners
import * as softwareActionOwners from "../../../../packages/capability-software-development/src/in-process-action-owners.mjs";

const {
	ensureScenarioStructure,
	saveScenario,
	validateScenarioPayload,
	validateScenarioScope,
} = softwareActionOwners as {
	ensureScenarioStructure: (payloadRaw?: string) => unknown;
	saveScenario: (options?: Record<string, unknown>) => unknown;
	validateScenarioPayload: (payloadRaw?: string) => unknown;
	validateScenarioScope: (scopeRaw?: string) => unknown;
};

function expandAttr(node: Node, ctx: Context, key: string): string {
	return expandVariables(String(node.attrs[key] || ""), ctx).trim();
}

function jsonOutcome(value: unknown, contextUpdates: Record<string, string> = {}): Outcome {
	return {
		status: StageStatus.Completed,
		output: JSON.stringify(value),
		contextUpdates,
	};
}

class ValidateScenarioScopeAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(validateScenarioScope(expandAttr(request.node, request.ctx, "action_payload") || request.input));
	}
}

class EnsureScenarioStructureAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(ensureScenarioStructure(expandAttr(request.node, request.ctx, "action_payload") || request.input));
	}
}

class ValidateScenarioPayloadAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(validateScenarioPayload(expandAttr(request.node, request.ctx, "action_payload") || request.input));
	}
}

class SaveScenarioAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(saveScenario({
			payload: expandAttr(request.node, request.ctx, "action_payload") || request.input,
			registryRoot: expandAttr(request.node, request.ctx, "action_registry_root"),
		}));
	}
}

export function registerScenarioActions(registry: ActionRegistry): void {
	registry.register("scenario.validate_scope", new ValidateScenarioScopeAction());
	registry.register("scenario.ensure_structure", new EnsureScenarioStructureAction());
	registry.register("scenario.validate_payload", new ValidateScenarioPayloadAction());
	registry.register("scenario.save", new SaveScenarioAction());
}
