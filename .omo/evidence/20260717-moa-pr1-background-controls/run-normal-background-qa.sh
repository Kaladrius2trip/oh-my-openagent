#!/usr/bin/env bash
set -euo pipefail

repo_root="/root/workspace/oh-my-openagent-moa-pr1"
evidence_dir="$repo_root/.omo/evidence/20260717-moa-pr1-background-controls"
real_db="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db"
real_count_before="$(sqlite3 "$real_db" 'SELECT count(*) FROM session' 2>/dev/null || printf 'unavailable')"
fake_pid=""
sandbox_root=""
qa_exit=1

cleanup() {
  if [ -n "$fake_pid" ]; then
    kill "$fake_pid" 2>/dev/null || true
    wait "$fake_pid" 2>/dev/null || true
  fi
  if [ -n "$sandbox_root" ] && [ -d "$sandbox_root" ]; then
    rm -rf "$sandbox_root"
  fi
  real_count_after="$(sqlite3 "$real_db" 'SELECT count(*) FROM session' 2>/dev/null || printf 'unavailable')"
  {
    printf 'real_db=%s\n' "$real_db"
    printf 'real_session_count_before=%s\n' "$real_count_before"
    printf 'real_session_count_after=%s\n' "$real_count_after"
    printf 'real_session_count_unchanged=%s\n' "$([ "$real_count_before" = "$real_count_after" ] && printf yes || printf no)"
    printf 'fake_server_stopped=%s\n' "$([ -n "$fake_pid" ] && ! kill -0 "$fake_pid" 2>/dev/null && printf yes || printf no)"
    printf 'sandbox_removed=%s\n' "$([ -n "$sandbox_root" ] && [ ! -d "$sandbox_root" ] && printf yes || printf no)"
    printf 'driver_exit=%s\n' "$qa_exit"
  } >"$evidence_dir/normal-qa-cleanup.txt"
}
trap cleanup EXIT

source "$repo_root/script/agent/qa-sandbox.sh"
sandbox_root="$OMO_QA_ROOT"
qa_project="$OMO_QA_ROOT/proj"
mkdir -p "$qa_project"
omo_log="${TMPDIR:-/tmp}/oh-my-opencode.log"
omo_log_offset=0
if [ -f "$omo_log" ]; then
  omo_log_offset="$(wc -c <"$omo_log" | tr -d ' ')"
fi
rm -f "$evidence_dir/normal-fake-llm.log" "$evidence_dir/normal-plugin.log"

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

mkdir -p "$XDG_CONFIG_HOME/opencode"
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
timeout 150 opencode run \
  "Run the split probe: call task exactly once as instructed, then run the bash hold command." \
  --format json \
  --model openai/gpt-fake \
  --dir "$qa_project" \
  >"$evidence_dir/normal-opencode-run.jsonl" \
  2>"$evidence_dir/normal-opencode-run.stderr"
run_exit=$?
set -e

printf 'command=opencode run <normal background prompt> --format json --model openai/gpt-fake --dir <isolated project>\nexit_code=%s\n' \
  "$run_exit" >"$evidence_dir/normal-opencode-run-command.txt"
test "$run_exit" -eq 0
grep -q '"tool":"task"' "$evidence_dir/normal-opencode-run.jsonl"
grep -q 'branch=parent-tool-call' "$evidence_dir/normal-fake-llm.log"
grep -q 'branch=child' "$evidence_dir/normal-fake-llm.log"
if [ -f "$omo_log" ]; then
  tail -c "+$((omo_log_offset + 1))" "$omo_log" >"$evidence_dir/normal-plugin.log"
fi
grep -q '\[background-agent\] notifyParentSession called for task' "$evidence_dir/normal-plugin.log"
grep -q '\[background-agent\] Queued notification' "$evidence_dir/normal-plugin.log"

sandbox_db="$XDG_DATA_HOME/opencode/opencode.db"
test -f "$sandbox_db"
sandbox_count="$(sqlite3 "$sandbox_db" 'SELECT count(*) FROM session')"
test "$sandbox_count" -ge 2
wake_turn_seen="$([ "$(grep -c 'branch=wake' "$evidence_dir/normal-fake-llm.log" || true)" -gt 0 ] && printf yes || printf no)"
printf 'sandbox_db=%s\nsandbox_session_count=%s\nnormal_task_tool_seen=yes\nchild_completion_seen=yes\nparent_notify_seen=yes\nparent_wake_queue_seen=yes\nparent_wake_model_turn_seen=%s\n' \
  "$sandbox_db" "$sandbox_count" "$wake_turn_seen" >"$evidence_dir/normal-qa-observed.txt"

qa_exit=0
