# Mothership graph role styles

All mothership graphs should import `../roles.stylesheet`:

```dot
@import "../roles.stylesheet"
```

Use role classes for LLM nodes:

- `class="reviewer"`
- `class="coder"`
- `class="supervisor"`
- `class="merge_resolver"`
- `class="triage_planner"`
- `class="goal_decomposer"`
- `class="goal_batch_reviewer"`
- `class="issue_writer"`
- `class="issue_quality_judge"`
- `class="post_merge_judge"`
- `class="scenario_author"`
- `class="release_narrator"`

Attribute precedence remains deterministic:

1. explicit node attributes
2. inline `model_stylesheet`
3. imported stylesheets

So per-node overrides (prompt, outputs, model tweaks, objective_id, etc.) still work.

Do not add per-graph `model_stylesheet` blocks just to set shared role model/provider defaults.
Put reusable role defaults in `factories/mothership/roles.stylesheet` instead.

For deterministic LLM routing precedence and node-level CLI introspection, see:
- `docs/architecture/llm-routing-policy.md`
- `hatch-ops factory model-policy --show-node-policy --graph-file <graph.dot> --node-id <node>`
