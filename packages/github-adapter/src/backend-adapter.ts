/**
 * Canonical backend adapter contract surface.
 *
 * Kept as a stable entrypoint so callers do not couple to implementation file
 * naming while local_fs and future backends land incrementally.
 */
export {
  BACKEND_ADAPTER_METHODS,
  assertBackendAdapterContract,
  isBackendAdapter,
} from "./backend-adapter-contract.ts";
