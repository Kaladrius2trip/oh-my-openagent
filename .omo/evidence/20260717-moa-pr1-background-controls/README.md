# What tested

- T1.1 through T1.9 strict red/green tests. `t1-*-red.txt` and `t1-*-green.txt` contain the original focused transcripts.
- Reviewer finding 1 durability and cleanup reproductions: `review-f1-red.txt`, `review-f1-cleanup-red.txt`, and `review-f1-green.txt`.
- Reviewer finding 3 mixed normal/internal sibling reproduction: `review-f3-red.txt` and `review-f3-green.txt`.
- Reviewer finding 4 arbitrary-delay audit: `review-f4-red.txt` and `review-f4-green.txt`.
- Reviewer finding 5 stale-evidence audit: `review-f5-red.txt` and `review-f5-green.txt`.
- `bun test packages/omo-opencode/src/features/background-agent packages/omo-opencode/src/tools/background-task`.
- `bun test packages/omo-opencode/src/tools/delegate-task packages/omo-opencode/src/hooks/team-session-events packages/omo-opencode/src/hooks/todo-continuation-enforcer packages/omo-opencode/src/hooks/atlas`.
- `bun test packages/omo-opencode/src/shared/prompt-async-route-audit.test.ts`.
- `bun run typecheck` and `bun run build`.
- TypeScript no-excuse checker over all 27 PR1 TypeScript files and separately over the 25 files without legacy whole-file findings.
- Comment checker over only added TypeScript lines from `da0ad92b4...HEAD`.
- Isolated real-plugin normal task: `bash .omo/evidence/20260717-moa-pr1-background-controls/run-normal-background-qa.sh`.
- Isolated all-six manager acceptance: `bash .omo/evidence/20260717-moa-pr1-background-controls/run-all-controls-manager-qa.sh`.
- Authoritative SSE watcher: `bash .omo/evidence/20260717-moa-pr1-background-controls/run-sse-qa.sh`, which calls `.agents/skills/opencode-qa/scripts/sse-hook-probe.sh --attach`.
- Evidence consistency: `bash .omo/evidence/20260717-moa-pr1-background-controls/qa-evidence-audit.sh`.

# Observed

- Background-agent/background-task acceptance: 820 pass, 0 fail, 2080 expectations, 79 files, exit 0.
- Delegate/team/todo/Atlas suites: 859 pass, 0 fail, 1945 expectations, 89 files, exit 0.
- Prompt route audit: 10 pass, 0 fail, exit 0.
- Reviewer reproduction suite: 21 pass, 0 fail, exit 0.
- Typecheck and build exited 0. The build left no generated tracked diff.
- Normal real-plugin task `bg_70dc5e35` created child `ses_08e6b773bffedGLKFkOryTeeK3` under parent `ses_08e6b9857ffefW72gwVqnkAKRg`. The run-specific log contains that exact launch, notify, and queued-wake task ID. It contains no `/root/.claude` path.
- The normal sandbox DB contained exactly two sessions. The real DB remained 1128 sessions before and after.
- The all-six task carried internal/manual/forbid/none/moa-consultation-only/orchestration. It produced zero notify, toast, wake, and tmux signals; zero public/sidebar rows; one internal row; zero prompt tools; durable forbidden continuation; and preserved parent lineage.
- SSE attach observed `server.connected`, exit 0. Its server and sandbox were removed.
- Exact PR1 TypeScript counts from `da0ad92b4...HEAD`: 17 production and 10 test files. See `changed-file-counts.json`.
- No-excuse: 25 files pass. The all-file run reports 16 legacy findings in `manager.ts` and `background-continuation.ts`; `verify-no-excuse-blame.log` shows every reported line belongs to a pre-PR1 commit.
- Added-line comment check: `COMMENT_CHECK_FILES=27 DETECTED_FILES=0`.

# Why enough

The real `opencode run --format json` probe loads this worktree's plugin with isolated HOME, XDG roots, config, temp log, and database. Assertions bind to IDs emitted by that run, so stale output cannot satisfy them. The all-six driver uses the actual `BackgroundManager.launch`, prompt dispatch, durable continuation store, toast manager, parent-publication seam, tmux callback, and sidebar snapshot builder. The focused and full suites cover all changed continuation gates, background tools, retry handling, task visibility, and normal regressions. Typecheck, build, policy audits, and the machine-readable evidence audit cover static and evidence consistency risks.

Reviewer finding 2 is rejected as a PR1 scope claim, not ignored. `review-f2-disposition.txt` proves that the legacy `spawner.ts` exports are test-only, absent from the public barrel, and excluded from the authoritative PR1 modification table. The planned second hardcoded resolver site is `spawner/task-prompt-body.ts`, which uses the shared resolver and is tested. Modifying dead `spawner.ts` would exceed the plan's file table without affecting the live manager path.

Crutch detection classified the accepted fixes as root fixes: durable per-session storage plus deletion cleanup replaces volatile state; the shared publishability predicate filters remaining siblings at the parent-facing source; subscribe-first callbacks replace timing guesses; and per-run HOME/XDG/TMP isolation plus ID-bound assertions removes stale-log dependence.

# Omitted

- The public `task` tool cannot accept the six policy fields until PR3 adds the MoA adapter. Therefore the all-six case uses the closest real manager seam and does not claim a public all-six SSE launch. The normal public path and SSE transport are exercised separately.
- No TUI visual smoke was run because PR1 changes snapshot visibility, not rendering. The actual sidebar snapshot builder and actual tmux callback gate are exercised in the all-six driver and tests.
- No `lsp_diagnostics` tool is exposed in this executor session. `verify-lsp-availability.txt` records that limitation; repository-wide root/script/package `tsgo` typechecks are green.
- The opencode-qa common self-check returns exit 1 only because this local OpenCode fork's `opencode db path` prints no path. Its isolation, dependency, port, cleanup, and home-shim checks pass. Direct SQLite counts in the acceptance driver prove DB isolation.
- `script/agent/sse-hook-probe.sh` does not exist. The authoritative skill copy at `.agents/skills/opencode-qa/scripts/sse-hook-probe.sh` was used. `script/agent/qa-sandbox.sh` was used by every QA driver.
- One read-only diagnostic command accidentally invoked `git -C ... config` without `GIT_MASTER=1` after the user's correction. It changed no state. Every subsequent git invocation was prefixed; this process deviation cannot be undone and is disclosed here.
- The authoritative v1.1 plan is absent from this worktree, so it was read from `/root/workspace/oh-my-openagent/.omo/plans/20260717-moa-consultation-integration.md`. That checkout and `packages/moa-core` were not modified.

# Cleanup

- `normal-qa-cleanup.txt`: fake server stopped, sandbox removed, driver exit 0, real DB count unchanged.
- `all-controls-manager-cleanup.txt`: sandbox removed, driver exit 0. The driver also shut down the manager, reset the toast singleton, cleared child continuation metadata, restored `TMUX`, and removed its temp project.
- `sse-qa-cleanup.txt`: server stopped, sandbox removed, driver exit 0.
- Two diagnosed hung QA startup attempts and one standalone SSE self-test attempt were terminated by exact PID; their sandbox cleanup traps completed. No broad process kill or real-home deletion was used.
- Final process inspection is recorded in `cleanup-final.txt`.
