
import { failClosedForUnknownContext, guardDisposableCleanup, guardGitMutation } from "../../src/lib/git-mutation-guard.ts";

import { registerSharedCases } from "../../../factory-runtime-guard/test/git-mutation-guard-role-boundary.shared-suite.ts";

registerSharedCases({ failClosedForUnknownContext, guardDisposableCleanup, guardGitMutation });
