#!/usr/bin/env bash
set -euo pipefail

# Host-side interface to the containerized development environment.
# The host starts things; the container runs them.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.yml"
DEV_SERVICE="dev"

# Three namespaces meet on the command line: commands, project names (a group
# of services) and service names. assert_namespaces keeps them distinct.
COMMANDS=(up shell exec logs down clean help)
# None here: the shared packages need no service of their own. A project
# lives in its own repo, with its own dev.sh.
PROJECTS=()

usage() {
  cat <<'EOF'
Usage: ./dev.sh <command> [subject]

  up [-d]             Start the development container and the browsers of the
                      tests (the playwright service). Without -d it opens a
                      shell inside the development container; with no terminal
                      attached it always detaches.
  shell [service]     Open a shell in a service (default: dev)
  exec <command>      Run one command in the development container
  logs [service...]   Follow logs (default: every service)
  down [service]      Stop everything, or one service (e.g. 'down dev')
  clean               Remove every node_modules and dist directory
  help                Show this message

Installing dependencies, building and running tests all happen inside the
development container. Never run pnpm on the host.
EOF
}

# The image aligns its `node` user with these; bash never exports UID and has
# no GID at all, so they have to be set here for compose to see them.
DEV_UID="$(id -u)"
DEV_GID="$(id -g)"
export DEV_UID DEV_GID

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

# Compose with every profile enabled, so profile-gated services are visible.
compose_all() {
  local args=()
  local project
  for project in "${PROJECTS[@]}"; do
    args+=(--profile "$project")
  done
  compose "${args[@]}" "$@"
}

all_services() {
  compose_all config --services
}

# Services a project owns: everything its profile adds to the base set. A
# project with none is a configuration error: passing an empty list on to
# compose would silently mean "every service".
project_services() {
  local project="$1"
  local services
  services="$(comm -13 \
    <(compose config --services | sort) \
    <(compose --profile "$project" config --services | sort))"
  if [[ -z "$services" ]]; then
    echo "Project '$project' has no services in $COMPOSE_FILE." >&2
    exit 1
  fi
  printf '%s\n' "$services"
}

is_in() {
  local needle="$1"
  shift
  local candidate
  for candidate in "$@"; do
    [[ "$candidate" == "$needle" ]] && return 0
  done
  return 1
}

is_project() {
  is_in "$1" "${PROJECTS[@]}"
}

is_service() {
  local service
  while read -r service; do
    [[ "$service" == "$1" ]] && return 0
  done < <(all_services)
  return 1
}

# A service outside every profile, such as the development container and the
# browsers of the tests: './dev.sh up' starts it.
is_base_service() {
  local service
  while read -r service; do
    [[ "$service" == "$1" ]] && return 0
  done < <(compose config --services)
  return 1
}

assert_namespaces() {
  local project
  for project in "${PROJECTS[@]}"; do
    if is_in "$project" "${COMMANDS[@]}"; then
      echo "Project '$project' shadows the command of the same name; rename it." >&2
      exit 1
    fi
    if is_service "$project"; then
      echo "Project '$project' shadows the service of the same name; rename one." >&2
      exit 1
    fi
  done
}

require_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is not reachable. Is Docker Desktop running?" >&2
    exit 1
  fi
}

# The compose project has a fixed name, so a clone or a worktree of this repo
# drives the same containers: from there, `exec` would run in the tree the
# dev container mounts, and `up` would recreate it on the clone. The dev
# container, running or stopped, must mount this checkout at its working
# directory, the tree its commands run in; -ef compares the directories
# themselves, so a symlink to this checkout passes. With no dev container
# there is nothing to compare, and `up` creates one on this checkout.
require_this_checkout() {
  local ids id info project source
  ids="$(compose ps -a -q "$DEV_SERVICE")"
  for id in $ids; do
    # The project first: its name holds no space, a path may.
    info="$(docker inspect --format \
      '{{index .Config.Labels "com.docker.compose.project"}} {{range .Mounts}}{{if eq .Destination $.Config.WorkingDir}}{{.Source}}{{end}}{{end}}' \
      "$id")"
    project="${info%% *}"
    source="${info#* }"
    if [[ "$source" -ef "$ROOT_DIR" ]]; then
      continue
    fi
    {
      if [[ -n "$source" ]]; then
        echo "The dev container mounts $source, not this checkout ($ROOT_DIR)."
      else
        echo "The dev container mounts nothing at its working directory, so not this checkout ($ROOT_DIR)."
      fi
      echo "./dev.sh drives it only from the checkout it mounts. Another checkout's code runs in a throwaway container of the dev image: see docker/README.md."
      # Only when no checkout can take it back: a hint that frees the stack
      # would hand it to any checkout refused here, through its next `up`.
      if [[ -z "$source" ]]; then
        echo "Remove the stack with 'docker compose -p $project down'."
      elif [[ ! -e "$source" ]]; then
        echo "$source no longer exists: remove the stack with 'docker compose -p $project down'."
      fi
    } >&2
    exit 1
  done
}

require_running() {
  local service="$1"
  if [[ -n "$(compose ps -q "$service")" ]]; then
    return
  fi
  if is_base_service "$service"; then
    echo "Service '$service' is not running. Start it with './dev.sh up'." >&2
  else
    echo "Service '$service' is not running. Start it with './dev.sh up <project>'." >&2
  fi
  exit 1
}

# Bind-mounting a path that does not exist makes Docker create a root-owned
# directory there, which then breaks git inside the container.
ensure_host_files() {
  touch "$HOME/.gitconfig"
}

# Runs a command in the development container, and stops it when this script
# stops. A command that `compose exec` starts outlives its client: docker
# forwards no signal to it, and killing the client or closing its terminal
# leaves it running. Only a Ctrl-C typed into a terminal reaches it, as a
# character. So the command carries a marker, and docker/dev/stop-session.sh
# uses it to stop the command in the container.
run_in_dev() {
  SESSION_MARKER="$$-$RANDOM"
  # A signal ignored when this script started cannot be trapped: bash skips
  # the trap silently, and the client decides. It handles INT and TERM itself
  # and exits 130, which the check after `wait` catches. It keeps HUP
  # ignored, so nothing ends, as `nohup` asks. On QUIT it exits 2, like a
  # command could.
  trap 'on_signal HUP' HUP
  trap 'on_signal INT' INT
  trap 'on_signal QUIT' QUIT
  trap 'on_signal TERM' TERM

  # In the background, because bash runs no trap while a foreground command
  # runs, but interrupts `wait` for one. Without `<&0`, a background command
  # would read from /dev/null and lose the terminal and any piped input.
  compose exec -e "DEV_SH_SESSION=$SESSION_MARKER" "$DEV_SERVICE" "$@" <&0 &
  local status=0
  wait "$!" || status=$?

  # Above 128, the client may have ended first, by a signal or a broken pipe
  # (255, `./dev.sh exec … | head`), and the command may still run. Or the
  # command itself ended above 128, killed or by choice: stop-session.sh then
  # does nothing. HUP, because what the command was attached to is gone.
  if ((status > 128)); then
    trap '' HUP INT QUIT TERM
    signal_session HUP client-ended
  fi
  trap - HUP INT QUIT TERM
  return "$status"
}

on_signal() {
  local signal="$1"
  trap '' HUP INT QUIT TERM
  signal_session "$signal" trapped
  exit $((128 + $(kill -l "$signal")))
}

# Runs stop-session.sh in the container. Its client gets a process group of
# its own (set -m), and the caller ignores signals until it is launched: a
# second signal to this script's group, such as a second Ctrl-C, then ends
# this script at once, but cannot stop the client before it has reached the
# container. The streams go to /dev/null: after a HUP, the terminal is gone.
signal_session() {
  set -m
  compose exec -T "$DEV_SERVICE" \
    bash docker/dev/stop-session.sh "$SESSION_MARKER" "$1" "$2" \
    </dev/null >/dev/null 2>&1 &
  set +m
  trap - HUP INT QUIT TERM
  wait "$!" || true
}

# Not a login shell: Debian's /etc/profile would overwrite PATH and drop the
# pnpm global bin directory. The shell is probed first rather than tried and
# retried, so that exiting it non-zero does not open a second one.
open_shell() {
  local service="$1"
  if ! is_service "$service"; then
    echo "Unknown service: $service" >&2
    exit 1
  fi
  require_running "$service"

  local shell
  shell="$(compose exec "$service" sh -c 'command -v bash || echo /bin/sh' | tr -d '\r')"
  # stop-session.sh reaches the container through the repo's bind mount,
  # which only the development container has.
  if [[ "$service" == "$DEV_SERVICE" ]]; then
    run_in_dev "$shell"
  else
    compose exec "$service" "$shell"
  fi
}

# mapfile runs project_services in a subshell, so its own exit cannot stop the
# script: the caller has to check the result as well.
load_project_services() {
  local project="$1"
  mapfile -t PROJECT_SERVICES < <(project_services "$project")
  if [[ "${#PROJECT_SERVICES[@]}" -eq 0 ]]; then
    exit 1
  fi
}

stop_services() {
  compose stop "$@"
  compose rm -f "$@"
}

command_up() {
  local project="" detach=false argument

  for argument in "$@"; do
    case "$argument" in
      -d | --detach)
        detach=true
        ;;
      -*)
        echo "Unknown option: $argument" >&2
        exit 1
        ;;
      *)
        if is_project "$argument"; then
          project="$argument"
        elif is_base_service "$argument"; then
          echo "'$argument' is a service, not a project. './dev.sh up' starts it." >&2
          exit 1
        elif is_service "$argument"; then
          echo "'$argument' is a service, not a project. Use './dev.sh up <project>'." >&2
          exit 1
        else
          echo "Unknown project: $argument" >&2
          exit 1
        fi
        ;;
    esac
  done

  require_docker
  require_this_checkout
  ensure_host_files

  # --build so that editing docker/dev/Dockerfile or docker/playwright/Dockerfile
  # actually takes effect; with the layer cache this costs about a second when
  # nothing changed.
  if [[ -n "$project" ]]; then
    load_project_services "$project"
    compose --profile "$project" up -d --build "$DEV_SERVICE" "${PROJECT_SERVICES[@]}"
  else
    compose up -d --build "$DEV_SERVICE"
  fi

  # Opening a shell needs a terminal; from a script or a hook there is none.
  if [[ "$detach" == false && ! -t 0 ]]; then
    echo "No terminal attached, staying detached."
    detach=true
  fi

  if [[ "$detach" == true ]]; then
    echo "Development container is up. Enter it with './dev.sh shell'."
  else
    open_shell "$DEV_SERVICE"
  fi
}

command_down() {
  local subject="${1:-}"

  require_docker
  require_this_checkout

  if [[ -z "$subject" ]]; then
    compose_all down
    return
  fi

  if is_project "$subject"; then
    # Named explicitly: a bare `compose down` would take the development
    # container with it, killing whatever is running inside.
    load_project_services "$subject"
    stop_services "${PROJECT_SERVICES[@]}"
    return
  fi

  if is_service "$subject"; then
    stop_services "$subject"
    return
  fi

  echo "Unknown project or service: $subject" >&2
  exit 1
}

command_logs() {
  require_docker
  require_this_checkout

  if [[ "$#" -eq 0 ]]; then
    compose_all logs -f
    return
  fi

  local service
  for service in "$@"; do
    if ! is_service "$service"; then
      echo "Unknown service: $service" >&2
      exit 1
    fi
  done
  compose logs -f "$@"
}

assert_namespaces

command="${1:-help}"
shift || true

case "$command" in
  up)
    command_up "$@"
    ;;
  shell)
    require_docker
    require_this_checkout
    open_shell "${1:-$DEV_SERVICE}"
    ;;
  exec)
    if [[ "$#" -eq 0 ]]; then
      echo "Nothing to run: ./dev.sh exec <command>" >&2
      exit 1
    fi
    require_docker
    require_this_checkout
    require_running "$DEV_SERVICE"
    run_in_dev "$@"
    ;;
  logs)
    command_logs "$@"
    ;;
  down)
    command_down "$@"
    ;;
  clean)
    find "$ROOT_DIR" -type d \( -name node_modules -o -name dist \) -prune -exec rm -rf {} +
    echo "Removed every node_modules and dist directory. Reinstall with './dev.sh exec pnpm install'."
    ;;
  help | -h | --help)
    usage
    ;;
  *)
    echo "Unknown command: $command" >&2
    usage
    exit 1
    ;;
esac
