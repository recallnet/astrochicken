import { estimateComplexity, type ComplexityEstimate } from "./estimate.js";
import {
	COMPLEXITY_ESTIMATE_USAGE,
	loadComplexityInput,
	parseComplexityEstimateArgs,
} from "../cli/complexity-estimate-args.js";

export const COMPLEXITY_COMMAND_USAGE = "usage: hatch complexity estimate [opts]";

export interface ComplexityEstimateCommandError {
	message: string;
	usage: string;
	exitCode: number;
}

export type ComplexityEstimateCommandResult =
	| { ok: true; payload: ComplexityEstimate }
	| { ok: false; error: ComplexityEstimateCommandError };

export function runComplexityEstimateCommand(args: string[]): ComplexityEstimateCommandResult {
	if (args.length === 0 || args[0] !== "estimate") {
		return {
			ok: false,
			error: {
				message: COMPLEXITY_COMMAND_USAGE,
				usage: COMPLEXITY_ESTIMATE_USAGE,
				exitCode: 1,
			},
		};
	}

	const parsed = parseComplexityEstimateArgs(args.slice(1));
	if (!parsed.ok) {
		return {
			ok: false,
			error: {
				message: parsed.error.message,
				usage: parsed.error.usage,
				exitCode: parsed.error.exitCode,
			},
		};
	}

	let input: unknown;
	try {
		input = loadComplexityInput(parsed.value);
	} catch (error) {
		return {
			ok: false,
			error: {
				message: error instanceof Error ? error.message : String(error),
				usage: COMPLEXITY_ESTIMATE_USAGE,
				exitCode: 1,
			},
		};
	}

	return {
		ok: true,
		payload: estimateComplexity(input),
	};
}
