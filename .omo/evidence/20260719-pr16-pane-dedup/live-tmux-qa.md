# PR16 live tmux QA

## Surface

Real tmux server on isolated socket `pr16qa`. Test creates two `TmuxSessionManager` instances in one Bun process, delivers the same `session.created` event concurrently, kills the winning pane, clears manager tracking through `session.deleted`, and delivers the same event again.

All tmux mutation commands in the live test route through `tmux -L pr16qa`. No command targets the user's default socket. Teardown always runs `tmux -L pr16qa kill-server`.

## Command

```bash
OMO_LIVE_TMUX=1 bun test packages/omo-opencode/src/features/tmux-subagent/manager-live-pane-dedup.test.ts && if tmux -L pr16qa has-session 2>/dev/null; then exit 1; fi
```

## Observed output

```text
bun test v1.3.14 (0d9b296a)

 1 pass
 0 fail
 5 expect() calls
Ran 1 test across 1 file. [543.00ms]
```

The chained `has-session` check exited successfully with no output, proving the `pr16qa` server no longer existed after test teardown.

## Assertions

- Concurrent manager events execute one split.
- Exactly one pane carries `@omo_session=ses_live_shared`.
- Killing that pane leaves no stale ownership marker.
- Concurrent recreation again produces exactly one tagged pane.
- Replacement pane ID differs from killed pane ID.

## Why this is enough

Unit tests cover command construction, pre-split marker lookup, lock fallback, marker write, post-spawn rescan, duplicate self-kill, deferred retry, and source-target recovery. This live scenario proves those seams against real tmux state and a real isolated socket.

No OpenCode process was spawned. User-defined verification scope for this task was Bun tests, tsgo, build, and isolated tmux only, so no OpenCode DB or XDG state was touched.
