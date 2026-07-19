# PR16 verification

## TDD red evidence

### Cross-instance manager split

Command:

```bash
bun test packages/omo-opencode/src/features/tmux-subagent/manager-cross-instance-dedup.test.ts
```

Before manager integration:

```text
Expected number of calls: 1
Received number of calls: 2
0 pass
1 fail
```

### Post-spawn duplicate cleanup

Command:

```bash
bun test packages/omo-opencode/src/features/tmux-subagent/session-pane-deduplicator.test.ts
```

Before cleanup implementation:

```text
Expected: { kind: "existing", paneId: "%3" }
Received: { kind: "spawned", result: { success: true, spawnedPaneId: "%7" } }
2 pass
1 fail
```

## Final scoped test gate

Command:

```bash
bun test packages/omo-opencode/src/features/tmux-subagent
```

Observed:

```text
187 pass
1 skip
0 fail
468 expect() calls
Ran 188 tests across 23 files. [326.00ms]
```

The one skip is the opt-in live tmux test, run separately with `OMO_LIVE_TMUX=1` and recorded in `live-tmux-qa.md`.

## Typecheck gate

Command:

```bash
GIT_CONFIG_GLOBAL=/dev/null bun run typecheck
```

Observed: root `tsgo --noEmit`, script tsconfig, and every package tsconfig including `packages/omo-opencode/tsconfig.json` exited 0 with no diagnostics.

## Build gate

Command:

```bash
OMO_SKIP_MATERIALIZE=1 bun build packages/omo-opencode/src/index.ts --outdir /tmp/pr16-dist --target bun --format esm --external zod
```

Observed:

```text
Bundled 1971 modules in 108ms
index.js  5.58 MB  (entry point)
```

Exit code: 0.

## LSP diagnostics

Per-file diagnostics returned `No diagnostics found` for production files and new manager/live test files. Folder scan found no errors in the new session-pane deduplicator test after matcher typing was corrected. The folder-wide LSP view still reports pre-existing Bun ambient declaration mismatches in legacy tests, while the repository's authoritative tsgo gate is clean.

## Code-quality review

- New coordinator: 111 pure LOC, one responsibility: tmux session-pane ownership.
- New unit test: 164 pure LOC.
- New cross-instance test: 193 pure LOC.
- Live test: 210 pure LOC, warning band; no further behavior should be added without splitting setup helpers.
- `manager.ts` is a pre-existing oversized lifecycle orchestrator. PR16 adds only ownership seams and marks the inherited size exception with `SIZE_OK`; no unrelated refactor was permitted.
- No `any`, assertions, non-null assertions, `@ts-ignore`, `@ts-expect-error`, empty catch, direct tmux `Bun.spawn`, or un-restored `mock.module` was added.

## Fix classification

Helper/assist, keep. Duplicate plugin hosts are outside one manager's in-memory lock. Tmux marker plus native lock is bounded shared-resource ownership grounded in the real pane domain; post-spawn self-kill is fallback reconciliation, not symptom masking.
