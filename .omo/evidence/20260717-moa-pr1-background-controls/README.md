# What tested

- Strict T1.1 through T1.9 red/green tests. Each `t1-*-red.txt` records the expected pre-implementation failure and each green transcript records the focused and nearby regression pass.
- PR1 acceptance: `bun test packages/omo-opencode/src/features/background-agent packages/omo-opencode/src/tools/background-task`.
- Full delegate-task, team-session, todo-continuation, and Atlas suites touched by the continuation gates.
- Internal prompt route audit, repository typecheck, full build, changed-line comment check, TypeScript no-excuse check, and LSP diagnostics.
- Isolated SSE plumbing with `.agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test`.
- Normal real-harness behavior with `bash .omo/evidence/20260717-moa-pr1-background-controls/run-normal-background-qa.sh`. The driver sources `script/agent/qa-sandbox.sh`, loads this worktree's local plugin, uses a deterministic local OpenAI-compatible server, and executes `opencode run <prompt> --format json --model openai/gpt-fake --dir <isolated-project>`.
- All-six policy behavior at the closest BackgroundManager driver seams with the five focused policy, capability, continuation, notification, and visibility suites listed in `controls-seam-qa.txt`.

# Observed

- PR1 acceptance: 816 pass, 0 fail across 79 files.
- Related delegate/team/todo/Atlas regressions: 859 pass, 0 fail across 89 files.
- Prompt route audit: 10 pass, 0 fail. Typecheck and build exited 0; the build left no tracked diff.
- The normal `opencode run` exited 0, emitted a completed `task` tool event, launched a child on the local fake model, called `notifyParentSession`, and queued the normal parent wake. The process ended while the parent was active, so the queued wake did not become another model turn; this is recorded as `parent_wake_model_turn_seen=no`, not presented as a dispatch.
- The isolated OpenCode DB contained two sessions. The real DB session count was 1128 before and 1128 after.
- The all-six manager seam preserved policies and lineage, returned zero tools, rejected continuation, hid internal snapshots/sidebar rows, suppressed tmux pane creation, and kept notify/toast/wake counters at zero.
- SSE self-test observed `server.connected` and exited 0.

# Why enough

The real harness proves unchanged normal-task launch and notification-queue behavior through OpenCode itself. Focused manager tests cover the policy-only surface that PR1 exposes but the public tool cannot yet accept. The acceptance and affected-hook suites cover the complete changed blast radius, while typecheck/build and production-file LSP diagnostics cover static integration. Red transcripts show each behavior was absent before its implementation.

# Omitted

- A live all-six launch and live SSE absence assertion are not possible until PR3 exposes the controls through the MoA adapter. The manager notification queue seam is used and the limitation is recorded in `controls-seam-qa.txt`.
- No TUI visual session was run. PR1 changes no rendering code; the actual sidebar snapshot builder and tmux callback were exercised directly.
- Nine changed test files are outside the repository LSP TypeScript project because the package tsconfig excludes `**/*.test.ts`; the LSP reports missing inferred-project Bun/Node types for those files. All 18 production files have zero LSP errors, and every test runs green under Bun.
- The no-excuse checker reports 16 pre-existing findings in two legacy files. No reported line was introduced or modified by this branch; the other 25 changed TypeScript files are clean.
- The authoritative v1.1 plan was absent from this worktree, so it was read from the read-only source checkout. That checkout and `packages/moa-core` were not modified.

# Cleanup

- The normal driver stopped the fake model, removed its `omo-qa-sandbox` directory, and recorded `driver_exit=0` in `normal-qa-cleanup.txt`.
- The SSE helper stopped its isolated server and removed its sandbox. Two diagnosed hung attempts were terminated by exact PID and their EXIT traps removed both sandboxes.
- Process inspection found no remaining QA fake-model, `opencode run`, `opencode serve`, or SSE-probe process.
- Real OpenCode DB count remained 1128 before and after.
