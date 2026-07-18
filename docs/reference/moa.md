# Mixture of Advisors

Mixture of Advisors (MoA) runs a bounded consultation before implementation. Tool-free advisors analyze one objective in parallel. One aggregator returns a decision bundle. Parent OMO agent remains only implementation authority.

MoA is disabled by default. Disabled state registers no `moa_consult` tool, no `/moa` command, no manager, and doctor reports a skipped check.

## Enable MoA

```jsonc
{
  "moa": {
    "enabled": true,
    "default_preset": "architecture-balanced"
  }
}
```

Restart OpenCode after changing plugin configuration.

## Use MoA

```text
/moa Should we split this module before adding another adapter?
```

Bare `/moa` prints usage and preset guidance. Agents can call `moa_consult` directly:

```json
{
  "prompt": "Choose a migration strategy for this API boundary.",
  "preset": "planning-rigorous"
}
```

Omit `preset` to use `default_preset`.

## Built-in presets

| Preset | Intended use |
| --- | --- |
| `architecture-balanced` | General architecture and migration decisions. Default. |
| `hermes-like-frontier` | Two frontier references with a frontier aggregator. |
| `code-review` | Deep review of contracts, regressions and failure modes. |
| `planning-rigorous` | Adversarial planning before parent execution. |
| `security-critical` | Trust boundaries, secrets, sandboxing and abuse cases. |
| `decision-fast` | Consequential choices with bounded latency. |
| `budget` | Lower-cost broad second opinion. |

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `moa.enabled` | `false` | Registers MoA runtime, tool and command. |
| `moa.default_preset` | `architecture-balanced` | Preset used when caller omits one. |
| `moa.default_prompt_pack` | `omo-hermes-derived-v1` | Built-in prompt pack identifier. |
| `moa.max_advisors_per_run` | `8` | Hard advisor cap, from 1 through 8. |
| `moa.presets` | none | Project-defined preset records. |
| `moa.prompt_packs` | none | Project-defined prompt-pack records. |

Preset fields control advisors, aggregator, context bounds, diversity thresholds, success threshold and timeouts. Every preset accepts only `execution_policy: "consultation_only"`. Every advisor accepts only `tool_policy: "none"` and one mode from `analysis`, `research`, `planning`, `review` or `evidence-search`.

### Per-role temperature

Set `temperature` from `0` through `2` on each advisor or aggregator slot:

```jsonc
{
  "moa": {
    "enabled": true,
    "default_preset": "diverse-advice",
    "presets": {
      "diverse-advice": {
        "execution_policy": "consultation_only",
        "advisors": [
          {
            "name": "architect",
            "category": "moa-architect",
            "temperature": 0.8,
            "tool_policy": "none"
          }
        ],
        "aggregator": {
          "category": "moa-aggregator",
          "temperature": 0.2
        }
      }
    }
  }
}
```

Precedence is slot temperature, then resolved category temperature, then provider default. A slot override applies to its primary model and every runtime fallback. Built-in presets do not set temperatures.

Doctor warns when an explicit slot temperature targets a statically known primary model with `supportsTemperature: false`. Unknown models, subagent targets and fallback capability changes do not produce this warning. Runtime model compatibility still removes temperature when active model metadata says it is unsupported.

## Result contract

`moa_consult` returns run ID, preset, terminal status, synthesis, advisor counts, configured and effective diversity, and warnings. Execution metadata is fixed:

```json
{
  "policy": "consultation_only",
  "toolsExposed": 0,
  "mutationsPerformed": 0,
  "implementationAuthority": "parent"
}
```

Fallback collapse can change a successful consultation from `completed` to `degraded`. Doctor predicts this risk from model fallback chains before a run.

## Security model

- Advisor and aggregator sessions receive zero tools through runtime capability enforcement.
- Internal sessions cannot notify, wake, resume or appear as normal background tasks.
- Parent system prompt, hidden messages and raw tool transcripts are excluded from default context.
- Advisor reports are escaped and placed inside an explicit untrusted XML boundary.
- Aggregator treats report commands as data and failures as diagnostics, not evidence.
- Provider errors lose local paths, UUIDs and stack traces before aggregation and are length-capped.
- Parent remains single writer. MoA cannot edit files, execute commands, delegate work or create commits.

## MoA compared with other modes

- **Team Mode** coordinates implementation-capable members with explicit task ownership. MoA advisors cannot act.
- **Hyperplan** runs adversarial plan review. MoA is a reusable consultation tool with preset model diversity.
- **Hermes virtual-provider MoA** routes through a provider abstraction. OMO uses an explicit tool and BackgroundManager lifecycle.

Advisor launches use existing BackgroundManager provider and model concurrency limits. Up to eight advisors can consume provider quota and tokens in one run. Start with `decision-fast` or `budget` when cost or latency matters.

See [MoA prompts](moa-prompts.md) for prompt composition and override rules.
