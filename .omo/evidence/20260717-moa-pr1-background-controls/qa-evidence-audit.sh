#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
evidence_dir="$repo_root/.omo/evidence/20260717-moa-pr1-background-controls"
normal="$evidence_dir/normal-qa-observed.json"
controls="$evidence_dir/all-controls-manager-qa.json"
counts="$evidence_dir/changed-file-counts.json"
pr1_base="da0ad92b4"

jq -e '
  .runExitCode == 0 and
  .normalTaskToolSeen == true and
  .taskBoundNotifySeen == true and
  .taskBoundWakeQueueSeen == true and
  .perRunPluginLog == true and
  .isolatedHome == true and
  .realSessionCountUnchanged == true and
  (.backgroundTaskID | startswith("bg_")) and
  (.childSessionID | startswith("ses_")) and
  (.parentSessionID | startswith("ses_"))
' "$normal" >/dev/null

jq -e '
  .controls.visibility == "internal" and
  .controls.notificationPolicy == "manual" and
  .controls.continuationPolicy == "forbid" and
  .controls.toolPolicy == "none" and
  .controls.capabilityProfile == "moa-consultation-only" and
  .controls.orchestration.kind == "moa" and
  .signals.notify == 0 and
  .signals.toast == 0 and
  .signals.wake == 0 and
  .signals.tmux == 0 and
  .visibility.publicSnapshotRows == 0 and
  .visibility.sidebarRows == 0 and
  .visibility.internalSnapshotRows == 1 and
  .promptToolCount == 0 and
  .continuationForbidden == true and
  .parentSessionIdPreserved == true
' "$controls" >/dev/null

jq -e '
  .productionCount == (.productionFiles | length) and
  .testCount == (.testFiles | length)
' "$counts" >/dev/null

production_count="$(GIT_MASTER=1 git diff --name-only "$pr1_base"...HEAD -- '*.ts' | grep -Ev '(\.test\.ts$|/test-support/)' | wc -l | tr -d ' ')"
test_count="$(GIT_MASTER=1 git diff --name-only "$pr1_base"...HEAD -- '*.ts' | grep -E '(\.test\.ts$|/test-support/)' | wc -l | tr -d ' ')"
test "$production_count" = "$(jq -r '.productionCount' "$counts")"
test "$test_count" = "$(jq -r '.testCount' "$counts")"

printf 'qa evidence audit passed\n'
