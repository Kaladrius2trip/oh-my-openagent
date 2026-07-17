#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
evidence_dir="$repo_root/.omo/evidence/20260717-moa-pr3-adapter"
sandbox_root=""
driver_exit=1

cleanup() {
  if [ -n "$sandbox_root" ] && [ -d "$sandbox_root" ]; then
    rm -rf "$sandbox_root"
  fi
  {
    printf 'sandbox_removed=%s\n' "$([ -n "$sandbox_root" ] && [ ! -d "$sandbox_root" ] && printf true || printf false)"
    printf 'driver_exit=%s\n' "$driver_exit"
  } >"$evidence_dir/manager-qa-cleanup.txt"
}
trap cleanup EXIT

source "$repo_root/script/agent/qa-sandbox.sh"
sandbox_root="$OMO_QA_ROOT"
export HOME="$OMO_QA_ROOT/home"
export USERPROFILE="$HOME"
export TMPDIR="$OMO_QA_ROOT/tmp"
export TMP="$TMPDIR"
export TEMP="$TMPDIR"
mkdir -p "$HOME" "$TMPDIR"

printf 'command=bun run .omo/evidence/20260717-moa-pr3-adapter/run-manager-qa.ts\n' \
  >"$evidence_dir/manager-qa-command.txt"
bun run "$evidence_dir/run-manager-qa.ts" \
  >"$evidence_dir/manager-qa.json" \
  2>"$evidence_dir/manager-qa.stderr"
driver_exit=0
