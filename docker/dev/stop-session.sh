#!/usr/bin/env bash
set -euo pipefail

# Runs in the development container, called by dev.sh when a command it
# started here may outlive it:
#
#   stop-session.sh <marker> <signal> trapped
#     dev.sh trapped <signal>. The command may not have started yet, so it is
#     looked for 10 times, 0.1 s apart.
#   stop-session.sh <marker> <signal> client-ended
#     dev.sh's client ended with a signal or a broken pipe. Nothing happens
#     unless the command itself still runs: one that ended on its own may
#     have left processes running on purpose.
#
# Passes the signal on to the command and to everything it started, then
# kills whatever is left after a grace period.
#
# docker starts every exec'd command as the leader of its own session, and
# what it starts stays in that session even when it leaves its process group
# or drops its environment, as turbo's tasks do. So the marker (an
# environment variable dev.sh gave the command) finds the session, and the
# session finds the rest. A process that moves to a session of its own keeps
# the marker, so its session is found too.

marker="DEV_SH_SESSION=$1"
signal="$2"
mode="$3"
grace_seconds=10

# The processes that carry the marker, comma-separated for `ps -p`. grep exits
# 2 for the entries it cannot read: a zombie's, or a process's that just
# ended. So every process listed was alive a moment ago.
marked_pids() {
  { grep -lsxzF -- "$marker" /proc/[0-9]*/environ || true; } |
    sed 's|^/proc/||; s|/environ$||' | paste -sd,
}

marked_sessions() {
  local pids
  pids="$(marked_pids)"
  [[ -n "$pids" ]] || return 0
  { ps -o sid= -p "$pids" || true; } | tr -d ' ' | sort -u
}

# The command docker started is the one marked process whose parent is
# outside the container: its PPID is 0.
command_runs() {
  local pids ppids
  pids="$(marked_pids)"
  [[ -n "$pids" ]] || return 1
  ppids="$(ps -o ppid= -p "$pids" || true)"
  grep -qx ' *0' <<<"$ppids"
}

# Zombies do not count: one whose parent has not reaped it yet ended all the
# same.
has_live_process() {
  local sid stats
  for sid in "$@"; do
    stats="$(ps -o stat= -s "$sid" || true)"
    if [[ -n "$stats" ]] && grep -qv '^ *Z' <<<"$stats"; then
      return 0
    fi
  done
  return 1
}

case "$mode" in
  trapped)
    lookups=10
    ;;
  client-ended)
    command_runs || exit 0
    lookups=1
    ;;
  *)
    echo "Unknown mode: $mode" >&2
    exit 2
    ;;
esac

sessions=()
for ((lookup = 1; lookup <= lookups; lookup++)); do
  mapfile -t sessions < <(marked_sessions)
  ((${#sessions[@]} > 0)) && break
  ((lookup < lookups)) && sleep 0.1
done
((${#sessions[@]} > 0)) || exit 0

for sid in "${sessions[@]}"; do
  pkill "-$signal" -s "$sid" || true
done

for _ in $(seq $((grace_seconds * 4))); do
  has_live_process "${sessions[@]}" || exit 0
  sleep 0.25
done

for sid in "${sessions[@]}"; do
  pkill -KILL -s "$sid" || true
done
