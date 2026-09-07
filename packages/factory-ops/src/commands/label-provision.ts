import { provisionManagedFactoryLabels } from "../lib/factory-label-contract.ts";

export function runLabelProvision({
  factoryKind = "",
  targetRepo = "",
  controlPlaneRepo = "",
  dryRun = false,
  ghExec,
  authCheck,
} = {}) {
  return provisionManagedFactoryLabels({
    kindId: factoryKind,
    targetRepo,
    controlPlaneRepo,
    dryRun,
    ghExec,
    authCheck,
  });
}
