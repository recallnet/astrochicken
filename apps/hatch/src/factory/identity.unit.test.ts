import { describe, expect, it } from "vitest";

import {
	FACTORY_INSTALLATION_ID_PREFIX,
	FACTORY_INSTALLATION_ID_REGEX,
	FACTORY_INSTANCE_ID_PREFIX,
	FACTORY_INSTANCE_ID_REGEX,
	FACTORY_STABLE_ID_PAYLOAD_REGEX,
	GRANDFATHERED_MOTHERSHIP_INSTANCE_ID,
	generateFactoryInstallationId,
	generateFactoryInstanceId,
	isValidFactoryInstallationId,
	isValidFactoryInstanceId,
} from "./identity.js";

describe("factory identity helpers", () => {
	it("generates valid fac_* instance ids", () => {
		const instanceId = generateFactoryInstanceId();
		expect(instanceId.startsWith(FACTORY_INSTANCE_ID_PREFIX)).toBe(true);
		expect(FACTORY_INSTANCE_ID_REGEX.test(instanceId)).toBe(true);
		expect(FACTORY_STABLE_ID_PAYLOAD_REGEX.test(instanceId.slice(FACTORY_INSTANCE_ID_PREFIX.length))).toBe(true);
		expect(isValidFactoryInstanceId(instanceId)).toBe(true);
	});

	it("generates valid inst_* installation ids", () => {
		const installationId = generateFactoryInstallationId();
		expect(installationId.startsWith(FACTORY_INSTALLATION_ID_PREFIX)).toBe(true);
		expect(FACTORY_INSTALLATION_ID_REGEX.test(installationId)).toBe(true);
		expect(isValidFactoryInstallationId(installationId)).toBe(true);
	});

	it("accepts only mothership as the grandfathered instance id", () => {
		expect(isValidFactoryInstanceId(GRANDFATHERED_MOTHERSHIP_INSTANCE_ID, { allowGrandfatheredMothership: true })).toBe(true);
		expect(isValidFactoryInstanceId("brainstorm", { allowGrandfatheredMothership: true })).toBe(false);
	});

	it("rejects lowercase and malformed ids", () => {
		expect(isValidFactoryInstanceId("fac_lowercase")).toBe(false);
		expect(isValidFactoryInstallationId("inst_short")).toBe(false);
	});
});
