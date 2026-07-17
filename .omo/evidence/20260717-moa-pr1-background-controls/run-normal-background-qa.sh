#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
evidence_dir="$repo_root/.omo/evidence/20260717-moa-pr1-background-controls"
opencode_bin="$(command -v opencode)"
real_home="$HOME"
real_db="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db"
real_count_before="missing"
if [ -f "$real_db" ]; then
  real_count_before="$(sqlite3 "$real_db" 'SELECT count(*) FROM session')"
fi

fake_pid=""
fake_stopped=false
sandbox_root=""
sandbox_removed=false
run_exit=1
qa_exit=1
normal_task_tool_seen=false
child_completion_seen=false
task_bound_launch_seen=false
task_bound_notify_seen=false
task_bound_wake_queue_seen=false
per_run_plugin_log=false
isolated_home=false
background_task_id=""
child_session_id=""
parent_session_id=""
sandbox_count=0

cleanup() {
  if [ -n "$fake_pid" ]; then
    kill "$fake_pid" 2>/dev/null || true
    wait "$fake_pid" 2>/dev/null || true
    fake_stopped=true
  fi
  sandbox_opencode_log="$XDG_DATA_HOME/opencode/log/opencode.log"
  if [ -f "$sandbox_opencode_log" ]; then
    cp "$sandbox_opencode_log" "$evidence_dir/normal-opencode-internal.log"
  fi
  if [ -n "$sandbox_root" ] && [ -d "$sandbox_root" ]; then
    rm -rf "$sandbox_root"
  fi
  if [ -n "$sandbox_root" ] && [ ! -d "$sandbox_root" ]; then
    sandbox_removed=true
  fi

  real_count_after="missing"
  if [ -f "$real_db" ]; then
    real_count_after="$(sqlite3 "$real_db" 'SELECT count(*) FROM session')"
  fi
  real_count_unchanged=false
  if [ "$real_count_before" = "$real_count_after" ]; then
    real_count_unchanged=true
  fi

  jq -n \
    --argjson runExitCode "$run_exit" \
    --argjson normalTaskToolSeen "$normal_task_tool_seen" \
    --argjson childCompletionSeen "$child_completion_seen" \
    --argjson taskBoundLaunchSeen "$task_bound_launch_seen" \
    --argjson taskBoundNotifySeen "$task_bound_notify_seen" \
    --argjson taskBoundWakeQueueSeen "$task_bound_wake_queue_seen" \
    --argjson perRunPluginLog "$per_run_plugin_log" \
    --argjson isolatedHome "$isolated_home" \
    --argjson realSessionCountUnchanged "$real_count_unchanged" \
    --argjson sandboxSessionCount "$sandbox_count" \
    --arg backgroundTaskID "$background_task_id" \
    --arg childSessionID "$child_session_id" \
    --arg parentSessionID "$parent_session_id" \
    --arg realDatabase "$real_db" \
    --arg realSessionCountBefore "$real_count_before" \
    --arg realSessionCountAfter "$real_count_after" \
    '{
      runExitCode: $runExitCode,
      normalTaskToolSeen: $normalTaskToolSeen,
      childCompletionSeen: $childCompletionSeen,
      taskBoundLaunchSeen: $taskBoundLaunchSeen,
      taskBoundNotifySeen: $taskBoundNotifySeen,
      taskBoundWakeQueueSeen: $taskBoundWakeQueueSeen,
      perRunPluginLog: $perRunPluginLog,
      isolatedHome: $isolatedHome,
      realSessionCountUnchanged: $realSessionCountUnchanged,
      backgroundTaskID: $backgroundTaskID,
      childSessionID: $childSessionID,
      parentSessionID: $parentSessionID,
      sandboxSessionCount: $sandboxSessionCount,
      realDatabase: $realDatabase,
      realSessionCountBefore: $realSessionCountBefore,
      realSessionCountAfter: $realSessionCountAfter
    }' >"$evidence_dir/normal-qa-observed.json"

  {
    printf 'real_db=%s\n' "$real_db"
    printf 'real_session_count_before=%s\n' "$real_count_before"
    printf 'real_session_count_after=%s\n' "$real_count_after"
    printf 'real_session_count_unchanged=%s\n' "$real_count_unchanged"
    printf 'fake_server_stopped=%s\n' "$fake_stopped"
    printf 'sandbox_removed=%s\n' "$sandbox_removed"
    printf 'driver_exit=%s\n' "$qa_exit"
  } >"$evidence_dir/normal-qa-cleanup.txt"
}
trap cleanup EXIT

source "$repo_root/script/agent/qa-sandbox.sh"
sandbox_root="$OMO_QA_ROOT"
export HOME="$OMO_QA_ROOT/home"
export USERPROFILE="$HOME"
export TMPDIR="$OMO_QA_ROOT/tmp"
export TMP="$TMPDIR"
export TEMP="$TMPDIR"
qa_project="$HOME/proj"
mkdir -p "$qa_project" "$HOME" "$TMPDIR"
if [[ "$HOME" == "$OMO_QA_ROOT"/* ]]; then
  isolated_home=true
fi

plugin_log="$TMPDIR/oh-my-opencode.log"
test ! -e "$plugin_log"
rm -f \
  "$evidence_dir/normal-fake-llm.log" \
  "$evidence_dir/normal-plugin.log" \
  "$evidence_dir/normal-qa-observed.json"

FAKE_LLM_LOG="$evidence_dir/normal-fake-llm.log" \
  bun run --bun "$repo_root/.agents/skills/opencode-qa/scripts/lib/fake-openai-server.mjs" \
  >"$evidence_dir/normal-fake-server.stdout" 2>"$evidence_dir/normal-fake-server.stderr" &
fake_pid=$!

fake_port=""
for _attempt in $(seq 1 50); do
  fake_port="$(sed -n 's/^fake-openai listening on //p' "$evidence_dir/normal-fake-server.stdout" | head -1)"
  if [ -n "$fake_port" ]; then
    break
  fi
  kill -0 "$fake_pid" 2>/dev/null
  sleep 0.2
done
test -n "$fake_port"
curl --max-time 5 -fsS "http://127.0.0.1:$fake_port/health" >/dev/null

mkdir -p "$XDG_CONFIG_HOME/opencode/node_modules"
printf '%s\n' \
  '{' \
  '  "dependencies": { "@opencode-ai/plugin": "0.0.0-qa-local" }' \
  '}' >"$XDG_CONFIG_HOME/opencode/package.json"
printf '%s\n' \
  '{' \
  '  "lockfileVersion": 3,' \
  '  "packages": {' \
  '    "": { "dependencies": { "@opencode-ai/plugin": "0.0.0-qa-local" } }' \
  '  }' \
  '}' >"$XDG_CONFIG_HOME/opencode/package-lock.json"
printf '%s\n' \
  '{' \
  "  \"plugin\": [\"file://$repo_root/packages/omo-opencode/src/index.ts\"]," \
  '  "model": "openai/gpt-fake",' \
  '  "provider": {' \
  '    "openai": {' \
  '      "options": {' \
  '        "apiKey": "fake-key",' \
  "        \"baseURL\": \"http://127.0.0.1:$fake_port/v1\"," \
  '        "timeout": 30000' \
  '      },' \
  '      "models": {' \
  '        "gpt-fake": {' \
  '          "tool_call": true,' \
  '          "limit": { "context": 200000, "output": 8192 }' \
  '        }' \
  '      }' \
  '    }' \
  '  },' \
  '  "permission": { "bash": "allow", "task": "allow" }' \
  '}' >"$XDG_CONFIG_HOME/opencode/opencode.jsonc"

printf '%s\n' \
  '{' \
  '  "agents": {' \
  '    "explore": { "model": "openai/gpt-fake" },' \
  '    "librarian": { "model": "openai/gpt-fake" }' \
  '  }' \
  '}' >"$XDG_CONFIG_HOME/opencode/oh-my-openagent.json"

set +e
timeout "${OMO_QA_RUN_TIMEOUT_SECONDS:-150}" "$opencode_bin" run \
  "Run the split probe: call task exactly once as instructed, then run the bash hold command." \
  --format json \
  --model openai/gpt-fake \
  --dir "$qa_project" \
  >"$evidence_dir/normal-opencode-run.jsonl" \
  2>"$evidence_dir/normal-opencode-run.stderr"
run_exit=$?
set -e

printf 'command=%s run <normal background prompt> --format json --model openai/gpt-fake --dir <isolated project>\nexit_code=%s\n' \
  "$opencode_bin" "$run_exit" >"$evidence_dir/normal-opencode-run-command.txt"
test "$run_exit" -eq 0

task_event="$(jq -c 'select(
  .type == "tool_use" and
  .part.tool == "task" and
  .part.state.status == "completed"
)' "$evidence_dir/normal-opencode-run.jsonl" | head -1)"
test -n "$task_event"
normal_task_tool_seen=true
parent_session_id="$(jq -r '.sessionID' <<<"$task_event")"
background_task_id="$(jq -r '.part.state.metadata.backgroundTaskId' <<<"$task_event")"
child_session_id="$(jq -r '.part.state.metadata.sessionId' <<<"$task_event")"
[[ "$parent_session_id" == ses_* ]]
[[ "$background_task_id" == bg_* ]]
[[ "$child_session_id" == ses_* ]]

grep -q 'branch=child' "$evidence_dir/normal-fake-llm.log"
child_completion_seen=true
test -f "$plugin_log"
cp "$plugin_log" "$evidence_dir/normal-plugin.log"
if ! grep -Fq "$real_home/.claude" "$evidence_dir/normal-plugin.log"; then
  per_run_plugin_log=true
fi

launch_line="$(grep -F '[background-agent] Launching task:' "$evidence_dir/normal-plugin.log" | grep -F "\"taskId\":\"$background_task_id\"" | grep -F "\"sessionID\":\"$child_session_id\"" || true)"
test -n "$launch_line"
task_bound_launch_seen=true
grep -Fq "[background-agent] notifyParentSession called for task: \"$background_task_id\"" "$evidence_dir/normal-plugin.log"
task_bound_notify_seen=true
wake_line="$(grep -F '[background-agent] Queued notification' "$evidence_dir/normal-plugin.log" | grep -F "\"taskId\":\"$background_task_id\"" || true)"
test -n "$wake_line"
task_bound_wake_queue_seen=true

sandbox_db="$XDG_DATA_HOME/opencode/opencode.db"
test -f "$sandbox_db"
sandbox_count="$(sqlite3 "$sandbox_db" 'SELECT count(*) FROM session')"
test "$sandbox_count" -ge 2

qa_exit=0
