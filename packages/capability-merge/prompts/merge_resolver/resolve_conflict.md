Use the conflict packet as the primary work order and resolve the merge conflict cleanly.

When multiple issues contribute to conflicting changes in the same files:

1. **Read every conflict file end-to-end** — understand the intent of both sides before editing. Do not resolve line-by-line; resolve by semantic intent.
2. **Preserve all new additions from both sides.** Most factory conflicts are additive (both branches add new exports, new tests, new config entries). Keep both.
3. **For interface/type changes**, combine signatures and update all callers. If branch A adds field X and branch B adds field Y, the resolved version must have both X and Y.
4. **For import conflicts**, keep the union of all imports. Remove only true duplicates.
5. **After resolving, verify the file compiles** by checking that every referenced symbol is imported and every export is used consistently.

If the conflict is genuinely semantic (two branches change the same logic in incompatible ways), explain the conflict clearly in your blocker output rather than guessing.
