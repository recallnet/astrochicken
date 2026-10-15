
import { evaluateManagedFactoryMutationPolicy, isControlPlane, isDestination, isTargetRepo, isLocalFilesystemPath, loadManagedFactoryMutationPolicyContract,  } from "../../src/lib/mutation-policy-contract.ts";

import { registerSharedCases } from "../../../factory-runtime-guard/test/mutation-policy-contract.shared-suite.ts";

registerSharedCases({ evaluateManagedFactoryMutationPolicy, isControlPlane, isDestination, isTargetRepo, isLocalFilesystemPath, loadManagedFactoryMutationPolicyContract });
