import { describe, expect, it } from "vitest";

import { usesReservedMothershipScenarioLeaf } from "./scenario-root-contract.js";

describe("scenario root contract", () => {
	it("allows mothership to keep the astrochicken scenario leaf", () => {
		expect(usesReservedMothershipScenarioLeaf({
			factoryId: "mothership",
			scenariosRoot: "factories/mothership/scenarios/astrochicken",
		})).toBe(false);
	});

	it("rejects non-mothership factories that point at the astrochicken scenario leaf", () => {
		expect(usesReservedMothershipScenarioLeaf({
			factoryId: "example-trading",
			scenariosRoot: "factories/example-trading/scenarios/astrochicken",
		})).toBe(true);
	});

	it("ignores other non-mothership scenario roots", () => {
		expect(usesReservedMothershipScenarioLeaf({
			factoryId: "example-trading",
			scenariosRoot: "factories/example-trading/scenarios/example-trading",
		})).toBe(false);
	});
});
