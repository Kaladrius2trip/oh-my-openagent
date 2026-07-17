# What tested

PR4 acceptance for the `moa_consult` tool, its gated registry record, and the gated `/moa` builtin command.

- Isolated-XDG driver: `bash .omo/evidence/20260717-moa-pr4-tool/run-tool-qa.sh` (HOME + all XDG dirs redirected to a throwaway sandbox).
- Real `createMoaConsultTool`, real `createMoaToolsRecord`, real `loadBuiltinCommands`, real `createMoAManager` + `normalizeMoAConfig` + `MoAConfigSchema`.
- The MoA execution adapter is a fake port implementation (canned advisor reports + one aggregator decision bundle): external advisor models are forbidden for this task, so the model boundary is faked while every PR4 production unit runs for real.
- Enabled config (`moa.enabled=true`, minimal `qa` preset: 2 advisors across anthropic/openai, aggregator on google) vs disabled config.

# Observed

- 18/18 assertions passed, `driver_exit=0`, `tool-qa.stderr` empty.
- Registry gate: enabled config + constructed manager registers exactly `["moa_consult"]`; disabled config registers `[]`; enabled-but-no-manager registers `[]`.
- Command gate: `/moa` present only when enabled; its template dispatches `moa_consult`; absent when disabled.
- Tool contract (returned as tool-result `metadata`): `status=completed`, `preset=qa`, `execution={ policy: consultation_only, toolsExposed: 0, mutationsPerformed: 0, implementationAuthority: parent }`, `advisorSummary={requested:2, successful:2, failed:0, timedOut:0}`, `diversity` outcome `satisfied`.
- Synthesis passed `validateDecisionBundle` (all 12 decision-bundle sections present, zero extras).
- Launch trace: 2 advisor launches then 1 aggregator launch; every launch carried `toolPolicy="none"` and `visibility="internal"` (advisors provably tool-free).
- Zero file writes: the driver's isolated project sandbox held 0 files before and 0 files after the run (`sandbox.filesBefore`/`filesAfter` both empty).

# Verification

- `bun test packages/omo-opencode/src/tools/moa-consult packages/omo-opencode/src/plugin packages/omo-opencode/src/features/builtin-commands`: 642 pass, 0 fail, 1688 expectations across 77 files.
- Focused: `moa-consult-tool.test.ts` 4, `tool-registry-moa.test.ts` 3, `moa-command.test.ts` 5.
- `bun run typecheck`: exit 0 across root, scripts, and every package project.
- `GIT_CONFIG_GLOBAL=/dev/null bun run build`: all steps completed (`verify-build.log`). `/dev/null` is required because `/root/.gitconfig` rewrites HTTPS GitHub URLs to SSH and breaks the submodule build step.
- `git diff --check`: exit 0.

# Why enough

The driver crosses the exact PR4 production surface: the tool factory maps a real `MoAManager.run` result into the `MoAConsultToolResult` contract, the registry record gates on `moa.enabled` + manager presence, and the command loader gates `/moa` on `moa.enabled`. Faking only the execution-adapter port is legitimate because PR3 already proved the adapter/manager/BackgroundManager path (see `20260717-moa-pr3-adapter`); PR4 consumes it unchanged and adds only the tool, registry gate, and command gate proven here. `toolsExposed=0` is asserted both at the contract level and at every child launch (`toolPolicy="none"`), and zero writes are proven by an empty-before/empty-after snapshot of the isolated project sandbox.

# Omitted

- No live `opencode run` server invocation: driving real advisor + aggregator models over a live server needs external model providers, which are forbidden for this task. The tool, registry, and command paths are instead exercised in-process with the same fake-model seam PR3 used.
- No SSE/SQLite/tmux/parent-wake claims: those transport and invisibility paths are PR1 + PR3 scope and are unchanged here.

# Cleanup

- `tool-qa-cleanup.txt` records `driver_exit=0`, `sandbox_removed=true`, and the isolated HOME/XDG path.
- The driver removes its temporary project sandbox in a `finally` block; the runner removes the isolated XDG sandbox after capturing output.
