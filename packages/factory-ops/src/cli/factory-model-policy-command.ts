import { Command, Option } from "clipanion";

export class FactoryModelPolicyCommand extends Command {
  static paths = [["factory", "model-policy"]];
  static usage = Command.Usage({
    description: "Display effective factory model routing policy and selector-level provenance.",
    details: "Selector precedence: --llm-path-id > --node > --class/--role > --graph > factory default.",
  });

  factoryId = Option.String("--factory-id", { required: false });
  factoryRoot = Option.String("--factory-root", { required: false });
  factoryConfigPath = Option.String("--factory-config-path", { required: false });
  compareFactoryRoot = Option.String("--compare-factory-root", {
    required: false,
    description: "Path to a second factory root for policy comparison. Both factories must exist locally.",
  });
  graph = Option.String("--graph", { required: false });
  node = Option.String("--node", { required: false });
  className = Option.String("--class", { required: false });
  role = Option.String("--role", { required: false });
  llmPathId = Option.String("--llm-path-id", { required: false });
  graphFile = Option.String("--graph-file", { required: false });
  nodeId = Option.String("--node-id", { required: false });
  nodeRole = Option.String("--node-role", { required: false });
  showNodePolicy = Option.Boolean("--show-node-policy", false);
  jsonOutput = Option.Boolean("--json", false);

  async execute() {
    try {
      const {
        resolveModelPolicyOutput,
        resolveNodeRoutingPolicy,
      } = await import("../commands/factory-model-policy.ts");

      const result = this.showNodePolicy
        ? await resolveNodeRoutingPolicy({
          factoryRoot: this.factoryRoot,
          factoryId: this.factoryId,
          factoryConfigPath: this.factoryConfigPath,
          graphFile: this.graphFile,
          nodeId: this.nodeId,
          nodeRole: this.nodeRole,
          env: process.env,
        })
        : await resolveModelPolicyOutput({
          factoryRoot: this.factoryRoot,
          factoryId: this.factoryId,
          factoryConfigPath: this.factoryConfigPath,
          compareFactoryRoot: this.compareFactoryRoot,
          graph: this.graph,
          node: this.node,
          className: this.className,
          role: this.role,
          llmPathId: this.llmPathId,
        });

      if (this.jsonOutput) {
        this.context.stdout.write(`${JSON.stringify(result)}\n`);
        return 0;
      }

      this.context.stdout.write(`Policy Version:    ${result.policy_version}\n`);
      this.context.stdout.write(`Factory ID:        ${result.factory_id}\n`);
      this.context.stdout.write(`Policy Source:     ${result.policy_source}\n`);
      this.context.stdout.write(`Preferred Model:   ${result.preferred_model}\n`);
      this.context.stdout.write(`Allowed Models:    ${(result.allowed_models || []).join(", ")}\n`);
      this.context.stdout.write(`Provider Order:    ${(result.provider_order || []).join(", ")}\n`);

      if (result.effective_provider) {
        this.context.stdout.write(`Effective Provider:${` ${result.effective_provider}`}\n`);
      }
      if (result.effective_model) {
        this.context.stdout.write(`Effective Model:   ${result.effective_model}\n`);
      }
      if (result.effective_reasoning) {
        this.context.stdout.write(`Reasoning:         ${result.effective_reasoning}\n`);
      }
      if (result.winner_source) {
        this.context.stdout.write(`Winner Source:     ${result.winner_source}\n`);
      }
      if (result.selected_via) {
        this.context.stdout.write(`Selected Via:      ${result.selected_via}\n`);
      }
      if (result.selector?.kind) {
        this.context.stdout.write(`Selector Kind:     ${result.selector.kind}\n`);
      }
      if (result.graph_path) {
        this.context.stdout.write(`Graph:             ${result.graph_path}\n`);
      }
      if (result.node_id) {
        this.context.stdout.write(`Node:              ${result.node_id}\n`);
      }
      if (result.class) {
        this.context.stdout.write(`Class:             ${result.class}\n`);
      }
      if (result.role) {
        this.context.stdout.write(`Role:              ${result.role}\n`);
      }
      if (result.llm_path_id) {
        this.context.stdout.write(`LLM Path ID:       ${result.llm_path_id}\n`);
      }

      if (result.safe_fallback_model) {
        this.context.stdout.write(`Safe Fallback:     ${result.safe_fallback_model}\n`);
      }
      if (this.showNodePolicy && this.nodeRole) {
        this.context.stdout.write(`Node Role:         ${this.nodeRole}\n`);
      }

      if (Array.isArray(result.overrides) && result.overrides.length > 0) {
        this.context.stdout.write("\nOverrides:\n");
        for (const entry of result.overrides) {
          this.context.stdout.write(
            `  - ${entry.layer}.${entry.key}: ${entry.value} (source=${entry.source_key})\n`,
          );
        }
      }

      if (result.benchmark_justification) {
        this.context.stdout.write("\nBenchmark Justification:\n");
        this.context.stdout.write(`  Evidence Date:   ${result.benchmark_justification.evidence_date || "(not set)"}\n`);
        this.context.stdout.write(`  Notes:           ${result.benchmark_justification.notes || "(none)"}\n`);
        if ((result.benchmark_query_links || []).length > 0) {
          this.context.stdout.write("  Linked Queries:\n");
          for (const link of result.benchmark_query_links) {
            this.context.stdout.write(`    - ${link.query_id}: ${link.description}\n`);
          }
        }
      }

      if (result.node_policy) {
        const policy = result.node_policy;
        this.context.stdout.write("\nNode Policy:\n");
        this.context.stdout.write(`  Graph File:      ${policy.graph_file}\n`);
        this.context.stdout.write(`  Node ID:         ${policy.node_id}\n`);
        this.context.stdout.write(
          `  Policy Defaults: provider=${policy.policy.policy_defaults.provider}, model=${policy.policy.policy_defaults.model}\n`,
        );
        this.context.stdout.write(
          `  Effective Defaults: provider=${policy.policy.defaults.provider.value} (${policy.policy.defaults.provider.source_layer}), model=${policy.policy.defaults.model.value} (${policy.policy.defaults.model.source_layer})\n`,
        );
        this.context.stdout.write(
          `  Node Overrides:  provider=${policy.node.overrides.provider || "(none)"}, model=${policy.node.overrides.model || "(none)"}, reasoning=${policy.node.overrides.reasoning || "(none)"}\n`,
        );
      }

      if (Array.isArray(result.attempt_chain) && result.attempt_chain.length > 0) {
        this.context.stdout.write("\nAttempt Chain:\n");
        for (const attempt of result.attempt_chain) {
          const marker = attempt.is_winner ? "*" : "-";
          const comment = attempt.precedence_comment || attempt.reason || attempt.skip_reason || "";
          this.context.stdout.write(
            `  ${marker} [${attempt.chain_index}] ${attempt.provider}/${attempt.model_id} phase=${attempt.fallback_phase} via=${attempt.selected_via}${comment ? ` // ${comment}` : ""}\n`,
          );
        }
      }

      if (result.comparison) {
        this.context.stdout.write(`\nComparison (${result.comparison.factory_a} vs ${result.comparison.factory_b}):\n`);
        if ((result.comparison.differing_fields || []).length === 0) {
          this.context.stdout.write("  (no differences)\n");
        } else {
          for (const diff of result.comparison.differing_fields) {
            this.context.stdout.write(
              `  ${diff.field}: ${JSON.stringify(diff.factory_a_value)} -> ${JSON.stringify(diff.factory_b_value)}\n`,
            );
          }
        }
      }

      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }
  }
}
