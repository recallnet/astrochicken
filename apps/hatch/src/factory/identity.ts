import { randomBytes } from "node:crypto";

export const FACTORY_INSTANCE_ID_PREFIX = "fac_" as const;
export const FACTORY_INSTALLATION_ID_PREFIX = "inst_" as const;
export const GRANDFATHERED_MOTHERSHIP_INSTANCE_ID = "mothership" as const;

const STABLE_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const STABLE_ID_PAYLOAD_LENGTH = 16;
const STABLE_ID_PAYLOAD_LENGTH_PATTERN = "{10,32}";

export const FACTORY_STABLE_ID_PAYLOAD_REGEX = new RegExp(`^[0-9A-HJKMNP-TV-Z]${STABLE_ID_PAYLOAD_LENGTH_PATTERN}$`);
export const FACTORY_INSTANCE_ID_REGEX = new RegExp(`^fac_[0-9A-HJKMNP-TV-Z]${STABLE_ID_PAYLOAD_LENGTH_PATTERN}$`);
export const FACTORY_INSTALLATION_ID_REGEX = new RegExp(`^inst_[0-9A-HJKMNP-TV-Z]${STABLE_ID_PAYLOAD_LENGTH_PATTERN}$`);

function encodeStableIdPayload(bytes: Uint8Array): string {
	let value = 0;
	let bits = 0;
	let output = "";

	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			output += STABLE_ID_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
			if (output.length >= STABLE_ID_PAYLOAD_LENGTH) return output;
		}
	}

	if (bits > 0 && output.length < STABLE_ID_PAYLOAD_LENGTH) {
		output += STABLE_ID_ALPHABET[(value << (5 - bits)) & 31];
	}

	return output.slice(0, STABLE_ID_PAYLOAD_LENGTH);
}

function generateStableIdPayload(): string {
	return encodeStableIdPayload(randomBytes(10));
}

export function generateFactoryInstanceId(): string {
	return `${FACTORY_INSTANCE_ID_PREFIX}${generateStableIdPayload()}`;
}

export function generateFactoryInstallationId(): string {
	return `${FACTORY_INSTALLATION_ID_PREFIX}${generateStableIdPayload()}`;
}

export function isValidFactoryInstanceId(
	value: string,
	opts: { allowGrandfatheredMothership?: boolean } = {},
): boolean {
	const normalized = String(value || "").trim();
	if (!normalized) return false;
	if (opts.allowGrandfatheredMothership && normalized === GRANDFATHERED_MOTHERSHIP_INSTANCE_ID) return true;
	return FACTORY_INSTANCE_ID_REGEX.test(normalized);
}

export function isValidFactoryInstallationId(value: string): boolean {
	return FACTORY_INSTALLATION_ID_REGEX.test(String(value || "").trim());
}
