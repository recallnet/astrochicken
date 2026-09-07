import {
  formatProvisioningDriftSummary,
  runProvisioningDriftCheck,
} from "../lib/factory-provisioning-drift.ts";

export {
  formatProvisioningDriftSummary,
  runProvisioningDriftCheck,
};

export function factoryProvisioningDrift(options = {}) {
  return runProvisioningDriftCheck(options);
}
