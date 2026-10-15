#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
: "${HATCH_FACTORY_ROOT:?set HATCH_FACTORY_ROOT to the factory being checked}"
exec node "$repo_root/apps/hatch/dist/cli.js" factory conformance --factory-root "$HATCH_FACTORY_ROOT" "$@"
