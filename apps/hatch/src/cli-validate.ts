import { isValidationMode, VALIDATION_MODES, type ValidationMode } from "./pipeline/validate.js";

export const VALIDATE_USAGE = "usage: hatch validate [--validation-mode <legacy|strict>] <file.dot>";

interface ParseSuccess {
	ok: true;
	validationMode: ValidationMode;
	file: string;
}

interface ParseFailure {
	ok: false;
	error: string;
	includeUsage: boolean;
}

export type ParseValidateCommandArgsResult = ParseSuccess | ParseFailure;

export function parseValidateCommandArgs(args: string[]): ParseValidateCommandArgsResult {
	let validationMode: ValidationMode = "legacy";
	const fileArgs: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if ((arg === "--validation-mode" || arg === "--mode") && i + 1 < args.length) {
			const raw = args[++i];
			const parsed = parseValidationModeArg(raw);
			if (!parsed) {
				return {
					ok: false,
					error: `invalid validation mode "${raw}" (expected: ${VALIDATION_MODES.join(", ")})`,
					includeUsage: false,
				};
			}
			validationMode = parsed;
			continue;
		}

		if (arg.startsWith("--validation-mode=") || arg.startsWith("--mode=")) {
			const raw = arg.substring(arg.indexOf("=") + 1);
			const parsed = parseValidationModeArg(raw);
			if (!parsed) {
				return {
					ok: false,
					error: `invalid validation mode "${raw}" (expected: ${VALIDATION_MODES.join(", ")})`,
					includeUsage: false,
				};
			}
			validationMode = parsed;
			continue;
		}

		if (arg.startsWith("--")) {
			return {
				ok: false,
				error: `unknown validate flag: ${arg}`,
				includeUsage: true,
			};
		}

		fileArgs.push(arg);
	}

	if (fileArgs.length !== 1) {
		return {
			ok: false,
			error: VALIDATE_USAGE,
			includeUsage: false,
		};
	}

	return {
		ok: true,
		validationMode,
		file: fileArgs[0],
	};
}

function parseValidationModeArg(raw: string): ValidationMode | null {
	if (!isValidationMode(raw)) return null;
	return raw;
}
