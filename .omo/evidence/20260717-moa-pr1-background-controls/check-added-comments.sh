#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
base="da0ad92b4"
checker="$repo_root/node_modules/@code-yeongyu/comment-checker/cli.js"
files=0
detected=0

cd "$repo_root"
while IFS= read -r -d '' file; do
  files=$((files + 1))
  added="$(GIT_MASTER=1 git diff --unified=0 "$base"...HEAD -- "$file" | awk '
    /^\+\+\+/ { next }
    /^\+/ { sub(/^\+/, ""); print }
  ')"
  payload="$(jq -n \
    --arg file "$repo_root/$file" \
    --arg content "$added" \
    '{
      session_id: "moa-pr1-comment-audit",
      tool_name: "Write",
      transcript_path: "",
      cwd: "'"$repo_root"'",
      hook_event_name: "PostToolUse",
      tool_input: { file_path: $file, content: $content }
    }')"

  set +e
  checker_output="$(printf '%s' "$payload" | node "$checker" check 2>&1)"
  checker_exit=$?
  set -e
  if [ "$checker_exit" -eq 2 ]; then
    detected=$((detected + 1))
    printf 'detected_file=%s\n%s\n' "$file" "$checker_output"
  elif [ "$checker_exit" -ne 0 ]; then
    printf 'checker_error_file=%s exit_code=%s\n%s\n' "$file" "$checker_exit" "$checker_output" >&2
    exit "$checker_exit"
  fi
done < <(GIT_MASTER=1 git diff -z --name-only "$base"...HEAD -- '*.ts')

printf 'COMMENT_CHECK_FILES=%s DETECTED_FILES=%s\n' "$files" "$detected"
test "$detected" -eq 0
