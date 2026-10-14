# Security

This repository preserves an experimental control plane. There is no supported hosted service or promised security-update schedule.

Treat graph definitions, factory configuration, prompts, repositories, and agent plugins as executable trusted input. Coding agents and deterministic tool nodes run with the host user's permissions. Use dedicated hosts, development databases, and narrowly scoped provider/GitHub credentials. Keep HTTP and operator endpoints behind authenticated private networking; do not expose them directly to the Internet.

Do not reuse the original factory targets or telemetry settings. Supply your own environment configuration, and never commit local environment files, agent settings, tokens, database URLs containing passwords, or signing keys. Original operational notes are historical reference, not authorization to access Recall infrastructure.

Report a suspected vulnerability through the repository's private GitHub vulnerability-reporting feature when available. Do not post secrets or private run data in public issues.

Dependency review on 2026-10-14 still reports seven advisories with no published patched version: four high, one moderate, and two low. Pi coding-agent and its `extract-zip` dependency affect extension installation, credential-file writes, and HTML session exports. Avoid shared-user hosts, untrusted extension archives, and untrusted HTML exports. `braces` and `sprintf-js` affect development tools (pattern matching and document parsing); avoid processing untrusted inputs with those tools. These limitations remain even when repository checks pass.
