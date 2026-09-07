import { IDENTITY_MODES, isIdentityMode, type IdentityMode } from "../pipeline/identity.js";

export interface ValidateCommandArgs {
	file: string;
	identityMode?: IdentityMode;
}

export interface ValidateCommandArgError {
	message: string;
	usage: string;
	exitCode: number;
}

export type ValidateCommandArgParseResult =
	| { ok: true; value: ValidateCommandArgs }
	| { ok: false; error: ValidateCommandArgError };

export const VALIDATE_USAGE = `usage: hatch validate [--identity-mode <${IDENTITY_MODES.join("|")}>] <file.dot>`;

export function parseValidateCommandArgs(args: string[]): ValidateCommandArgParseResult {
	const files: string[] = [];
	let identityMode: IdentityMode | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--identity-mode") {
			if (i + 1 >= args.length) {
				return {
					ok: false,
					error: {
						message: "validate: --identity-mode requires a value",
						usage: VALIDATE_USAGE,
						exitCode: 1,
					},
				};
			}
			const value = args[++i];
			if (!isIdentityMode(value)) {
				return invalidModeError(value);
			}
			identityMode = value;
			continue;
		}

		if (arg.startsWith("--identity-mode=")) {
			const value = arg.slice("--identity-mode=".length);
			if (!isIdentityMode(value)) {
				return invalidModeError(value);
			}
			identityMode = value;
			continue;
		}

		if (arg.startsWith("--")) {
			return {
				ok: false,
				error: {
					message: `validate: unknown option: ${arg}`,
					usage: VALIDATE_USAGE,
					exitCode: 1,
				},
			};
		}

		files.push(arg);
	}

	if (files.length !== 1) {
		return {
			ok: false,
			error: {
				message: files.length === 0 ? "validate: missing <file.dot>" : "validate: expected exactly one <file.dot>",
				usage: VALIDATE_USAGE,
				exitCode: 1,
			},
		};
	}

	return {
		ok: true,
		value: {
			file: files[0],
			identityMode,
		},
	};
}

function invalidModeError(value: string): ValidateCommandArgParseResult {
	return {
		ok: false,
		error: {
			message: `validate: invalid --identity-mode "${value}" (expected: ${IDENTITY_MODES.join(", ")})`,
			usage: VALIDATE_USAGE,
			exitCode: 1,
		},
	};
}
