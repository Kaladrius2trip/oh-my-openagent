# What tested

- Isolated-XDG manager acceptance: `bash .omo/evidence/20260717-moa-pr3-adapter/run-manager-qa.sh`.
- Actual `MoAManager`, OpenCode MoA execution adapter, `BackgroundManager`, continuation store, task toast manager, and sidebar snapshot builder.
- Two advisor launches followed by exactly one aggregator launch.
- Internal/manual/tool-less/continuation-forbidden/tmux-suppressed consultation controls on every child.
- Parent lineage, prompt destination, configured/effective diversity, terminal status, public visibility, sidebar visibility, and parent signals.

# Observed

- Run `qa-run` completed with two successful advisor reports and one synthesis.
- Configured and effective diversity each observed two providers and two models.
- Three child sessions were created under `parent-moa-qa`: two advisors and one aggregator.
- All three tasks reached `completed`.
- All prompt dispatches targeted child sessions. Parent prompt dispatch count was zero.
- Public task rows: 0. Sidebar rows: 0. Internal task rows: 3.
- Notify, toast, wake, and tmux signals: 0.
- Every child prompt exposed zero tools.
- All assertions passed. `manager-qa.stderr` is empty.

# Verification

- `bun test packages/omo-opencode/src/features/moa packages/omo-opencode/src/shared/prompt-async-route-audit.test.ts`: 27 pass, 0 fail, 60 expectations.
- `bun run typecheck`: exit 0 across root, scripts, and package projects.
- TypeScript no-excuse review: no violations in 15 changed files.
- `GIT_CONFIG_GLOBAL=/dev/null bun run build`: all steps completed.
- `git diff --check`: exit 0.
- Production pure-source counts remain below 250 lines. `moa-manager.ts` is largest at 240.
- `lsp_diagnostics` could not inspect this linked worktree because tool access is restricted to `/root/workspace/agents-sandbox`. `verify-lsp-availability.txt` records exact error; full `tsgo` typecheck is green.

Initial build attempt failed before compilation because `/root/.gitconfig` rewrites public HTTPS GitHub URLs to SSH and current SSH agent cannot sign. `git ls-remote --get-url` confirmed rewrite. Process-scoped `GIT_CONFIG_GLOBAL=/dev/null` restored `.gitmodules` HTTPS URLs without changing repository or user config.

Initial whole-file no-excuse review exposed three legacy and one new un-narrowed `plugin-dispose.ts` catch values. All four catch boundaries now normalize non-`Error` values before logging; cleanup behavior remains continue-on-error.

# Why enough

This driver crosses the PR3 production boundary from `MoAManager.run` through `createMoAExecutionAdapter` into actual `BackgroundManager.launch`. Assertions bind to task and session IDs created during this run. PR1 already proved the underlying six-control BackgroundManager path and SSE transport; PR3 acceptance proves its new orchestration caller preserves those controls for both roles.

# Omitted

- No public CLI or tool invocation exists until PR4, so PR3 cannot launch MoA through a live OpenCode server without adding an out-of-scope entry point.
- No separate SSE or SQLite claim is made. Those transport and persistence paths were accepted in PR1 and are unchanged here.
- Child completions use the manager's test seam because external advisor models are forbidden for this task. Session creation, prompt dispatch, policies, visibility, and orchestration use production code.

# Cleanup

- `manager-qa-cleanup.txt` records `sandbox_removed=true` and `driver_exit=0`.
- Driver shuts down both managers, resets the toast singleton, clears continuation metadata, and removes its temporary project.
