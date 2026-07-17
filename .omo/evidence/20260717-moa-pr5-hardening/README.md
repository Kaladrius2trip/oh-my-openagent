# MoA PR5 hardening evidence

## What was tested

- MoA doctor disabled, valid, collapse-prone and missing-preset states.
- Config acceptance for `disabled_commands: ["moa"]` and regenerated schema.
- Seven adversarial advisor-report fixtures through aggregation composition.
- Error redaction for absolute paths, UUIDs, stack frames and length.
- Full consultation manager path with zero exposed tools, zero sandbox writes and zero active fake sessions after completion.
- Effective diversity collapse after runtime fallback.
- `moa_consult` sandbox evaluation across seven presets and three fixtures.
- Markdown links, TypeScript projects, schema generation and repository build gates.

## What was observed

- Doctor returned `skip` while disabled, `pass` for provider-distinct chains, `warn` with `openai` for shared fallback collapse, and `fail` for missing default preset.
- Adversarial report text stayed inside one `<advisor_report>` under one `<untrusted_advisor_reports>` boundary.
- Every consultation launch kept `toolPolicy: "none"` and `capabilityProfile: "moa-consultation-only"`.
- Sandbox sentinel content and directory listing were byte-identical after consultation. Active fake-session count returned to zero.
- Forced final-model collapse ended `degraded` with one effective provider and model. Aggregator still launched once.
- Eval produced 21 contract-valid entries: 14 `completed`, 7 `degraded`, zero exposed tools and zero mutations.

## Why this is enough

Tests cover machine-enforced capability controls, manager lifecycle, fallback diversity, prompt structure, sanitizer behavior and public tool result shape. Eval drives public `moa_consult` tool in deterministic sandbox mode without provider credentials or external AI processes.

## What was omitted

No provider prompts, credentials, environment dumps or raw private logs were captured. Live provider routing was not executed because task permits Bun tests, tsgo and repository scripts only and forbids external AI CLI processes.

## Acceptance criteria map

| AC | Coverage |
| --- | --- |
| AC-001 | `moa-schema.test.ts`, `managers-wiring.test.ts`, `moa.test.ts` disabled case. |
| AC-002 | `tool-registry-moa.test.ts`. |
| AC-003 | `preset-validation.test.ts`, `moa-schema.test.ts`. |
| AC-004 | `moa-manager.test.ts` target-resolution count before launch. |
| AC-005 | `moa-manager.test.ts` advisor fan-out. |
| AC-006 | `moa-execution-adapter.test.ts` delegates launches to BackgroundManager limits. |
| AC-007 | `moa-manager.test.ts` threshold and single-aggregator cases. |
| AC-008 | `capability-profile.test.ts`, `moa-execution-adapter.test.ts`, `zero-writes-e2e.test.ts`. |
| AC-009 | `moa-consult-tool.test.ts`, `zero-writes-e2e.test.ts`. |
| AC-010 | PR1 notification, visibility and tmux suppression tests. |
| AC-011 | PR1 normal-task regression cases. |
| AC-012 | `moa-manager.test.ts` partial failure case. |
| AC-013 | `moa-manager.test.ts` below-threshold case. |
| AC-014 | `moa-manager.test.ts` advisor deadline and cancellation cases. |
| AC-015 | `state-machine.test.ts`, aggregator terminal policy coverage. |
| AC-016 | `moa-manager.test.ts` parent cancellation case. |
| AC-017 | `fallback-retry-preservation.test.ts`, `moa-execution-adapter.test.ts`. |
| AC-018 | `context-bounding.test.ts` task-only case. |
| AC-019 | `context-bounding.test.ts` recent-text bounds. |
| AC-020 | `context-bounding.test.ts` recent-state bounds. |
| AC-021 | `prompt-injection.test.ts`, `zero-writes-e2e.test.ts`. |
| AC-022 | `output-contracts.test.ts`, `moa-consult-tool.test.ts`. |
| AC-023 | `moa-manager.test.ts`, built-in preset defaults. |
| AC-024 | Consultation result and evidence contain no prompt/output telemetry. Live telemetry capture not run. |
| AC-025 | `moa.test.ts` covers default preset, structural policy, category model and diversity diagnostics. Prompt override reachability remains covered by `placeholder-engine.test.ts`. |
| AC-026 | `moa-command.test.ts`. |
| AC-027 | Required schema, typecheck, build and scoped-test gates recorded in this bundle. |
| AC-028 | `zero-writes-e2e.test.ts`, manager cancel and shutdown tests. |
| AC-029 | `docs/reference/moa.md`. |
| AC-030 | `prompt-pack.test.ts` advisor composition order. |
| AC-031 | `prompt-pack.test.ts`, `prompt-injection.test.ts` aggregator envelope. |
| AC-032 | `prompt-pack.test.ts` template IDs, versions and hashes. |
| AC-033 | `placeholder-engine.test.ts`, `prompt-pack.test.ts`. |
| AC-034 | `prompt-pack.test.ts` built-in shadow rejection. |
| AC-035 | `diversity.test.ts`, `moa-manager.test.ts`. |
| AC-036 | `fallback-collapse-diversity.test.ts`. |
| AC-037 | `diversity.test.ts`, `fallback-collapse-diversity.test.ts`. |
| AC-038 | `output-contracts.test.ts` advisor report contract. |
| AC-039 | Aggregator base contract and decision-bundle contract tests. |
| AC-040 | `target-resolution.test.ts`. |
| AC-041 | `capability-profile.test.ts`, `moa-execution-adapter.test.ts`. |
| AC-042 | `preset-validation.test.ts` security-critical preset table. |
| AC-043 | `prompt-injection.test.ts` explicit security template revisions and prompt metadata coverage. |
| AC-044 | Seven adversarial fixtures run through route-independent composition. Live OpenAI, Anthropic and Google calls were intentionally omitted. Partial coverage. |
| AC-045 | `moa-schema.test.ts`, `preset-validation.test.ts`. |
| AC-046 | `moa-schema.test.ts`, `preset-validation.test.ts`. |
| AC-047 | `capability-profile.test.ts`, `zero-writes-e2e.test.ts`. |
| AC-048 | `continuation-policy.test.ts` and PR1 idle-gate tests. |
| AC-049 | `zero-writes-e2e.test.ts` sentinel, launch controls and tool count. |
| AC-050 | `output-contracts.test.ts`, aggregator contract. |
| AC-051 | `docs/reference/moa.md`, advisor mode contracts. |
| AC-052 | `docs/reference/moa.md`, aggregator ownership contract. |
| AC-053 | `output-contracts.test.ts`, advisor base contract. |
| AC-054 | `implementation-request` eval fixture, `zero-writes-e2e.test.ts`. |

## Material departures

- AC-044 live three-provider routing was not run. Deterministic prompt and capability tests cover provider-independent enforcement.
- Session unchanged proof uses manager-owned fake session handles, not a live OpenCode database. This avoids forbidden external AI CLI execution while proving no orphaned handles in repository tests.
