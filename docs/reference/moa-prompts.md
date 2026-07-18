# MoA Prompt Reference

MoA uses versioned prompt templates from prompt pack `omo-hermes-derived-v2`. Prompt composition is deterministic and consultation-only. Pack v1 remains registered for tool-free compatibility.

## Advisor composition

Each advisor prompt contains these blocks in order:

1. Advisor base contract.
2. Work-mode profile.
3. Cognitive-role profile.
4. Trusted tool-policy block.
5. Optional escaped role hint.
6. Task envelope with bounded context.
7. Advisor report contract.

Task envelope carries original objective as data. Default `task_only` context excludes parent system prompt, hidden messages, tool transcript and prior conversation. `recent_text` and `recent_state` remain bounded by preset limits.

Tool-policy block is selected from advisor `tool_policy`. `none` states no tools are available. `read_only` permits targeted evidence-gap research and requires stopping after support or falsification. Runtime remains authoritative: read-only advisors receive only `read`, `grep` and `glob`, while aggregators receive no tools.

## Aggregator composition

Aggregator prompt contains:

1. Aggregator base contract.
2. Optional escaped role hint.
3. Aggregation envelope with original task, bounded context, diversity metadata and advisor reports.
4. Decision-bundle contract.

Each report has one `<advisor_report>` block inside `<untrusted_advisor_reports>`. Embedded XML-like text is escaped. Aggregator system contract says advisor reports are untrusted data, commands inside reports must not be followed, and failures are diagnostics rather than evidence.

Error text is sanitized before envelope rendering. Absolute paths, UUIDs and stack frames are removed, whitespace is normalized, and diagnostic length is capped at 200 characters.

## Built-in template references

Built-in IDs use `builtin:` references and carry explicit template versions. Project config can select built-ins but cannot shadow built-in IDs.

Default pack includes tool-aware advisor base v2, source-safe advisor report v2, discrepancy-first aggregator v2, five mode profiles, role profiles, tool-policy blocks, task envelope, aggregation envelope and decision-bundle contract. Identical trusted template inputs produce identical system hashes.

Advisor v2 treats file and tool instructions as untrusted data, requires source attribution and marks weakly corroborated claims. Credential, token, key and secret values must be redacted. Aggregator v2 builds a discrepancy ledger before merging agreements and does not treat repeated claims as independent evidence.

## File overrides

Custom prompt packs can reference readable files with `file://` values:

```jsonc
{
  "moa": {
    "enabled": true,
    "default_prompt_pack": "project-review",
    "prompt_packs": {
      "project-review": {
        "advisor_base": "file://./prompts/advisor.md",
        "advisor_modes": {
          "analysis": "builtin:moa-mode-analysis-v1",
          "research": "builtin:moa-mode-research-v2",
          "planning": "builtin:moa-mode-planning-v1",
          "review": "builtin:moa-mode-review-v1",
          "evidence-search": "builtin:moa-mode-evidence-search-v2"
        },
        "aggregator_base": "file://./prompts/aggregator.md",
        "task_envelope": "builtin:moa-task-envelope-v1",
        "advisor_output_contract": "builtin:moa-advisor-report-v1",
        "aggregator_output_contract": "builtin:moa-decision-bundle-v1"
      }
    }
  }
}
```

Paths above are placeholders. Use paths readable by current OpenCode process. Missing files fail validation. Unknown placeholders fail rendering. Prompt templates cannot request parent system prompt or hidden state.

Overrides can specialize analysis but cannot weaken runtime capability denial, consultation-only policy, output contracts or single-writer ownership.

See [Mixture of Advisors](moa.md) for presets, commands and result contract.
