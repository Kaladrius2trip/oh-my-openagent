#!/usr/bin/env bash
# Isolated-XDG PR4 acceptance driver: real moa_consult tool + registry gate + /moa command gate,
# real MoAManager over a fake execution adapter (external advisor models are forbidden for this task).
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../../.." && pwd)"

sandbox="$(mktemp -d /tmp/moa-pr4-xdg.XXXXXX)"
export HOME="$sandbox"
export XDG_CONFIG_HOME="$sandbox/.config"
export XDG_DATA_HOME="$sandbox/.local/share"
export XDG_STATE_HOME="$sandbox/.local/state"
export XDG_CACHE_HOME="$sandbox/.cache"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"

cd "$repo_root"
bun run "$here/run-tool-qa.ts" > "$here/tool-qa.json" 2> "$here/tool-qa.stderr"
code=$?

echo "driver_exit=$code" > "$here/tool-qa-cleanup.txt"
rm -rf "$sandbox"
echo "sandbox_removed=true" >> "$here/tool-qa-cleanup.txt"
echo "xdg_home_isolated=$sandbox" >> "$here/tool-qa-cleanup.txt"
echo "driver_exit=$code"
exit $code
