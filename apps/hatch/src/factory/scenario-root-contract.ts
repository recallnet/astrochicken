import path from "node:path";

const MOTHERSHIP_FACTORY_ID = "mothership";
const MOTHERSHIP_SCENARIO_LEAF = "astrochicken";

export function usesReservedMothershipScenarioLeaf(args: {
	factoryId?: string;
	scenariosRoot?: string;
} = {}): boolean {
	const factoryId = String(args.factoryId || "").trim();
	const scenariosRoot = String(args.scenariosRoot || "").trim();
	if (!factoryId || !scenariosRoot || factoryId === MOTHERSHIP_FACTORY_ID) {
		return false;
	}
	return path.basename(path.normalize(scenariosRoot)) === MOTHERSHIP_SCENARIO_LEAF;
}
