#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
evidence_dir="$repo_root/.omo/evidence/20260717-moa-pr1-background-controls"
opencode_bin="$(command -v opencode)"
server_pid=""
server_stopped=false
sandbox_root=""
sandbox_removed=false
driver_exit=1

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    server_stopped=true
  fi
  if [ -n "$sandbox_root" ] && [ -d "$sandbox_root" ]; then
    rm -rf "$sandbox_root"
  fi
  if [ -n "$sandbox_root" ] && [ ! -d "$sandbox_root" ]; then
    sandbox_removed=true
  fi
  {
    printf 'server_stopped=%s\n' "$server_stopped"
    printf 'sandbox_removed=%s\n' "$sandbox_removed"
    printf 'driver_exit=%s\n' "$driver_exit"
  } >"$evidence_dir/sse-qa-cleanup.txt"
}
trap cleanup EXIT

source "$repo_root/script/agent/qa-sandbox.sh"
sandbox_root="$OMO_QA_ROOT"
export HOME="$OMO_QA_ROOT/home"
export USERPROFILE="$HOME"
export OPENCODE_TEST_HOME="$HOME"
export TMPDIR="$OMO_QA_ROOT/tmp"
export TMP="$TMPDIR"
export TEMP="$TMPDIR"
project_directory="$HOME/proj"
mkdir -p "$project_directory" "$TMPDIR" "$XDG_CONFIG_HOME/opencode/node_modules"

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
  '{}' >"$XDG_CONFIG_HOME/opencode/opencode.jsonc"

server_port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
server_password="moa-pr1-sse-local"
OPENCODE_SERVER_PASSWORD="$server_password" "$opencode_bin" serve \
  --port "$server_port" \
  --hostname 127.0.0.1 \
  >"$evidence_dir/sse-server.log" 2>&1 &
server_pid=$!

server_url="http://127.0.0.1:$server_port"
server_ready=false
for _attempt in $(seq 1 100); do
  if curl --max-time 2 -fsS -u "opencode:$server_password" "$server_url/global/health" >/dev/null 2>&1; then
    server_ready=true
    break
  fi
  kill -0 "$server_pid" 2>/dev/null
  sleep 0.2
done
test "$server_ready" = true

{
  printf '$ bash .agents/skills/opencode-qa/scripts/sse-hook-probe.sh --attach <isolated-server> --event server.connected\n'
  bash "$repo_root/.agents/skills/opencode-qa/scripts/sse-hook-probe.sh" \
    --attach "$server_url" \
    --password "$server_password" \
    --directory "$project_directory" \
    --event server.connected \
    --timeout 15
  printf 'exit_code=0\n'
} >"$evidence_dir/sse-qa.txt" 2>&1

driver_exit=0
