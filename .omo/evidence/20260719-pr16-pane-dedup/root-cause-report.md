# PR16 T2 root-cause report

## Finding

OpenCode's plugin cache is scoped to one Effect service graph, not to the process. The process can create multiple service graphs for the same directory. Each graph owns a separate `InstanceStore` and plugin state, so each graph invokes the same configured OMO server plugin once. OMO then constructs a separate `TmuxSessionManager` in each invocation.

Exact external server-plugin invocation:

- V1 plugin shape: `packages/opencode/src/plugin/index.ts:110-116`, call at line 114: `plugin.server(input, load.options)`.
- Legacy plugin shape: `packages/opencode/src/plugin/index.ts:118-120`, call at line 119: `server(input, load.options)`.

The duplicate is therefore two calls through the same invocation site from separate service graphs, not two calls inside one `InstanceStore` bootstrap.

## Call paths

Primary server graph:

1. Workspace routing selects directory at `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts:160-185`.
2. Instance context loads it at `packages/opencode/src/server/routes/instance/httpapi/middleware/instance-context.ts:23-34`.
3. `InstanceStore.load()` boots a directory instance at `packages/opencode/src/project/instance-store.ts:108-123`.
4. Bootstrap calls `Plugin.init()` at `packages/opencode/src/project/bootstrap.ts:32-39`.
5. Loader invokes OMO at `packages/opencode/src/plugin/index.ts:114` or legacy line 119.

Independent graph paths capable of repeating that sequence:

- Internal worker HTTP graph: `packages/opencode/src/server/server.ts:56-65`, then `packages/opencode/src/server/routes/instance/server.ts:315-322`.
- Network listener graph: `packages/opencode/src/server/server.ts:100-137`; its fresh memo/service state is created at lines 124-127.
- Global `AppRuntime` graph: `packages/opencode/src/effect/app-runtime.ts:58-111`.
- TUI schedules `checkUpgrade` at `packages/opencode/src/cli/cmd/tui.ts:265-267`; worker loads through `packages/opencode/src/cli/tui/worker.ts:59-61` and `packages/opencode/src/project/instance-runtime.ts:9`, reaching the independent `AppRuntime` graph.

## Ruled out

### Direct TUI invocation of OMO server export

Ruled out. `packages/opencode/src/plugin/shared.ts:272-304` selects exports strictly. TUI requires `default.tui` and rejects a server-only default at lines 296-300. TUI activation at `packages/opencode/src/plugin/tui/runtime.ts:676-695` cannot call OMO's `server()` export.

### Two concurrent loads inside one graph

Ruled out. `packages/opencode/src/project/instance-store.ts:108-123` keys the cache by `FSUtil.resolve(directory)` and concurrent callers await the same deferred instance. One graph plus one normalized directory gives one bootstrap unless explicit reload/dispose occurs.

### Built-in plus external OMO registration

Ruled out. Built-ins are fixed at `packages/opencode/src/plugin/index.ts:64-82`; OMO is loaded only from `cfg.plugin_origins` at lines 177-185.

## Secondary duplicate mechanisms

- `InstanceStore.reload()` replaces cache and reruns bootstrap at `packages/opencode/src/project/instance-store.ts:126-144`. Project `initGit` can trigger it at `packages/opencode/src/server/routes/instance/handlers/project.ts:23-33`.
- Plugin-origin dedup at `packages/opencode/src/config/plugin.ts:64-77` compares npm packages by package name but file plugins by literal file URL. Two aliases or symlink URLs to the same OMO file can survive and invoke line 114 twice in one bootstrap.

## Confidence and evidence gap

Confidence in service-graph scope as architectural cause: high. Confidence that the observed approximately 50 ms pair came from a specific pair of graphs: medium.

`/tmp/oh-my-opencode-debug.log` was absent during this investigation. Current `~/.local/share/opencode/log/opencode.log` contained no OMO entry, manager initialization, instance create, reload, or dispose lines. Without PID, effective `cfg.plugin_origins`, graph identity, and surrounding reload events, source alone cannot distinguish two graphs from two distinct file-URL origins for that exact historical run.

Deterministic follow-up instrumentation belongs immediately before `packages/opencode/src/plugin/index.ts:114`: log PID, resolved directory, graph identity, plugin origin `(spec, source, scope)`, and reload generation. Same origin with different graph identity proves the primary finding; differing file URLs prove alias-origin duplication.

## PR scope decision

No fork code changed. T1 makes tmux pane ownership process-independent and cross-process-safe, so duplicate plugin hosts cannot create duplicate panes while T2 remains a fork follow-up.
