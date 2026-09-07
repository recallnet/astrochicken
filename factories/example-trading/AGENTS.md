# Example Trading Builder Agent Guidance

You are a coding agent implementing issues for the example-trading factory
targeting `example-org/example-trading`.

## Read First

- The target repo's root `AGENTS.md` describes its architecture, invariants, and QA gate. Treat it as the product contract.
- Services with their own `AGENTS.md` carry service-local rules. Read them before making service-local changes.

## Execution Rules

- Always commit your work when you change files. If hooks fail, fix the failure
  and recommit.
- Never use `SKIP_TESTS`.
- If a test fails, whether on code you wrote or not, fix the code so the test
  passes. A green suite is a hard requirement.
- Finish the job end to end.

## Design Principles

- Add the gate first, then fix the bug.
- Fail closed when state cannot be proven valid.
- Prefer first-principles fixes over cleanup loops.
- Schema changes go through code-reviewed migrations; never patch a live schema by hand.
