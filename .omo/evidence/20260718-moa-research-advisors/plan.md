# PR15 research advisors execution plan

## Scope

- Base: `dev` at `f9aabc8d0`.
- Worktree: `/root/workspace/oh-my-openagent-pr15`.
- Branch: `feat/moa-pr15-research-advisors`.
- Order: Stage P0, Stage 2, Stage 3, integration and live QA, final gates.
- No push, merge, PR creation, external AI CLI, tmux-subagent, or tmux-core changes.

## Stage P0

1. Add an exposure-level RED test for OpenCode permission semantics: an empty tool map creates no permission rules and leaves the default registry exposed.
2. Add RED tests for `{ "*": false }`, closed capability profiles, invalid profiles, and conflicting profile/policy pairs.
3. Implement deny-all `none` and `moa-consultation-only` resolution.
4. Thread policy fields through direct launch, resume, and agent-not-found fallback without replacing profile tools.
5. Run targeted tests and diagnostics, capture RED and GREEN output, then commit capability resolution and spawner preservation as separate atomic units.

## Stage 2

1. Add `none | read_only` advisor config vocabulary, defaulting omitted values to `none`.
2. Evolve the harness-neutral child launch contract into advisor/aggregator role variants. Accept only advisor `none` or `read_only` pairs and tool-free aggregators.
3. Add exact research capability output: deny wildcard, allow `read`, `grep`, and `glob`, explicitly deny three MCP resource tools, and preserve only deny restrictions from user or agent policy.
4. Translate semantic `read_only` to background `default + moa-research`; pin aggregator to `none + moa-consultation-only`.
5. Add internal `maxToolCalls`, persist it through task records and fallback, and enforce task override before global circuit-breaker default. Research advisor cap is 12.
6. Report advisor policy, exposed names/counts, and zero aggregator tools in contracts, tool metadata, and eval schemas.
7. Run targeted tests and diagnostics after each RED/GREEN unit, then commit each unit.

## Stage 3

1. Version changed advisor, advisor-report, and aggregator builtins to v2 and update pack wiring and golden hashes.
2. Define research trust rules for untrusted file and tool output, evidence verification, credential handling, and discrepancy-first aggregation.
3. Set architecture-balanced, hermes-like-frontier, code-review, planning-rigorous, and security-critical advisors to `read_only`. Keep decision-fast and budget tool-free.
4. Make routing research-first and remove `--preset` teaching from `/moa`; keep tool-level preset support.
5. Document research tier and provider-disclosure caveat. Regenerate schema.
6. Run targeted tests and diagnostics after each RED/GREEN unit, then commit each unit.

## Integration and QA

1. Extend zero-writes E2E to prove research reads, unchanged sentinel/directory, and zero aggregator calls.
2. Add hostile source fixture with instructions to invoke forbidden tools or override contracts. Verify only escaped untrusted report reaches aggregator.
3. Bundle branch plugin and run real OpenCode under isolated HOME and XDG roots. Copy only auth needed for provider access into sandbox. Use transformed config and sandbox database.
4. Inspect actual child request/session tool registries: research advisor exactly `read`, `grep`, `glob`; tool-free advisor zero; aggregator zero. Prove repository read and unchanged filesystem. Compare real database counts before and after.
5. Run required targeted suites, full package suite with known-failure classification, typecheck, schema clean check, isolated bundle build, and changed-file diagnostics once.

## Commit sequence

1. `fix(background-agent): deny tool-free capability profiles`
2. `fix(background-agent): preserve capability policy in spawner`
3. `feat(moa): define advisor tool policy contract`
4. `feat(background-agent): add research capability profile`
5. `feat(background-agent): bound research advisor tool calls`
6. `feat(moa): translate research advisor launches`
7. `feat(moa): launch advisors by slot policy`
8. `feat(moa): report advisor tool exposure`
9. `feat(moa): version research advisor prompts`
10. `feat(moa): prioritize evidence discrepancies`
11. `feat(moa): make research presets default`
12. `fix(moa): simplify slash command routing`
13. `docs(moa): document research advisor security`
14. `test(moa): prove isolated research advisor boundaries`

Exact commit count may increase to keep each implementation with its direct tests and each directory concern independently revertible.
