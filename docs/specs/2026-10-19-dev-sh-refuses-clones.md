---
status: draft
type: chore
packages: []
branch: chore/repo/dev-sh-refuses-clones
---

# `./dev.sh` drives the dev container only from the checkout it mounts

## Why

The compose project has a fixed name (`name: enardo-packages`), so every checkout's `./dev.sh` drives the same containers. From a clone, `exec` and `shell` run in the dev container, whose working tree is the checkout that started it; `up` recreates that container with the clone's mount; `down` stops the stack. The probes on clones that the root `CLAUDE.md` and the agents prescribe reach the real tree as soon as one calls `./dev.sh` without a stub: in the first review of `chore/repo/test-handoff-and-idle-verify`, a hook probe on a clone ran the real `pnpm verify` against the shared tree.

From the backlog item `chore/repo/dev-sh-refuses-clones`, queued by the user at checkpoint 2 of `chore/repo/test-handoff-and-idle-verify` (2026-10-16).

## Probes

On the host, Docker Desktop 4.95.0 (engine 29.8.2, Compose 5.6.0) under WSL2:

- A clone in the scratchpad, on `main`, while the repo is on this branch: `./dev.sh exec git branch --show-current` → `chore/repo/dev-sh-refuses-clones`, exit 0. It ran in the repo's tree.
- Two clones A and B whose compose `name` is changed to `en-probe`, A's stack up:
  - B `./dev.sh exec git branch --show-current` → A's branch;
  - B `./dev.sh up -d` → `Container en-probe-dev-1 Recreate`, a new container ID, mounting B; A's `exec` then runs in B's tree;
  - with that container stopped, A `./dev.sh up -d` → `Recreate` again, mounting A: a stopped container is recreated as well.
- `docker inspect` of the dev container: `.Mounts` holds a bind of `Source: /home/enardo/Projects/enardo-packages` at `Destination: /workspaces/enardo-packages`, `.Config.WorkingDir` is `/workspaces/enardo-packages`. The template `{{$wd := .Config.WorkingDir}}{{range .Mounts}}{{if eq .Destination $wd}}{{.Source}}{{end}}{{end}}` prints that source; it takes 0.04 s, `compose ps -a -q dev` 0.1 s.
- Docker Desktop records the client's path as the source: a container created with `-v /mnt/c/Windows/Temp:/x` has `Source: /mnt/c/Windows/Temp`, not a translated path.
- Compose does not resolve symlinks: `compose config` from a symlink to the repo gives the symlink's path as the source of the mount.
- bash's `[[ a -ef b ]]` (same device and inode) → true for a symlink and its target, false for a clone, false when one path does not exist.
- `docker compose -p en-probe down`, run from a directory with no compose file → removes the project's containers and network, exit 0.
- `./dev.sh exec true` on this branch's first commit: 0.56–0.63 s.
- `.claude/settings.json` runs the `Stop` hook as `"${CLAUDE_PROJECT_DIR:-.}"/scripts/stop-hook.sh`: a session's own checkout, not a clone it works in.
- Cambusa's `dev.sh` has the same `ROOT_DIR` and `require_docker`, and its compose a fixed `name: cambusa`; its backlog has no item on clones.

## Decisions

1. **What tells the checkouts apart: the source of the dev container's bind mount at its working directory**, compared with `ROOT_DIR` as the same file (`-ef`). It is the tree that `exec` and `shell` run in, whatever the path is called: a symlink to the checkout passes, a clone or a worktree does not, and neither does a checkout nested inside the mounted one. Reading the destination from the container's `WorkingDir`, rather than naming `/workspaces/enardo-packages`, keeps the check true to a container started before a rename of the mount point. Not chosen:
   - **the compose label `com.docker.compose.project.working_dir`**, the directory of the compose file that created the container: it says which checkout started it, not which tree commands run in;
   - **a marker file**, written by `dev.sh` and looked for through `exec`: it would survive a translated path, which Docker Desktop does not produce (probed), and it writes into the tree and costs an `exec` on every call;
   - **a compose project per checkout**, named after its path: each clone gets a stack of its own, so nothing needs refusing. It renames the repo's stack, its containers and images, and a clone's `up` starts a second dev container and a second set of browsers. The item asks for a refusal.
2. **Every command that reaches Docker checks: `up`, `shell`, `exec`, `logs`, `down`.** `help` reaches nothing, and `clean` acts on `ROOT_DIR` only, which is right in a clone. `logs` only reads, but one rule for every command that calls Docker is easier to keep than a list of the dangerous ones. The check runs after `require_docker`, so an unreachable Docker still says so first.
3. **Only an existing dev container is compared, running or stopped.** `up` recreates a stopped one too (probed). With none, nothing is refused: `up` creates it with this checkout's mount, and the other checkouts are refused until it goes. A clone can take the stack this way only while it is down, and its writes then land in the clone. The `playwright` service mounts nothing and is not compared.
4. **The refusal names both paths and the way out**, on stderr, with exit 1 like `dev.sh`'s other failures: run `./dev.sh` from the mounted checkout, or remove the stack with `docker compose -p <project> down`, the project read from the container's `com.docker.compose.project` label. The second works when the mounted checkout no longer exists (probed), such as a deleted scratchpad clone.
5. **No ADR.** The rule belongs to one script, which enforces it, and `docker/README.md` states it; no other task has to respect it.

## Changes

- **`dev.sh`**: a function that finds the dev container (`compose ps -a -q`), reads the source of its mount at its working directory and its project label (one `docker inspect`), and exits 1 with the message of decision 4 unless that source `-ef` `ROOT_DIR`. A container without such a mount is refused too, with a message saying so. `up`, `shell`, `exec`, `logs` and `down` call it after `require_docker`.
- **`docker/README.md`**: a section saying that `./dev.sh` drives the stack only from the checkout the dev container mounts, what it compares, that the first checkout to `up` an absent stack holds it, and the way out.
- **`docs/backlog.md`**: the item leaves, in a commit of its own.

The `Stop` hook does not change. In a session started in a clone, its `./dev.sh exec pnpm verify` is refused, so the hook exits 2 with the refusal on stderr, where it used to verify the shared tree.

## Test cases

A shell script, which the repo tests with shellcheck only: each case is a manual check, listed in the commit body. They run on two clones A and B of the branch in the scratchpad, whose compose `name` is changed to `en-probe` and committed (a worktree checks out the committed file), so that no case can reach the repo's stack, even under a wrong implementation. Before each case, A's stack is up unless the case says otherwise; each one records the dev container's ID, status and mount before and after. Cases 3, 5 and 9 run first on this branch's first commit, where they do what *Probes* shows.

1. A, `exec git branch --show-current` → A's branch, exit 0.
2. A, through a symlink to A, the same → A's branch, exit 0.
3. B, `exec git branch --show-current` → exit 1, the message names B, A and `docker compose -p en-probe down`; git prints nothing.
4. B, `shell` and `shell playwright` → refused as in 3; no shell opens.
5. B, `up -d` → refused; the dev container keeps its ID.
6. B, `logs` and `logs playwright` → refused, without following any log.
7. B, `down` and `down dev` → refused; both of A's containers still run.
8. B, `help` → the usage, exit 0; B, `clean`, with a `dist/` in a package of A and of B → B's removed, A's kept.
9. A's dev container stopped: B, `up -d` → refused, the container keeps its ID and stays stopped; then A, `up -d` → it runs again, mounting A.
10. No dev container (`docker compose -p en-probe rm -sf dev`): B, `up -d` → creates it, mounting B; then A, `exec true` → refused, the message names A and B; then `docker compose -p en-probe down`, from the message → the stack is gone; A, `up -d` → mounting A.
11. A worktree of A inside A (`git -C A worktree add .wt`), `exec true` → refused: a checkout nested in the mounted one.
12. B, `DOCKER_HOST=unix:///nonexistent ./dev.sh exec true` → "Docker is not reachable", exit 1: the reachability check comes first.
13. B, its own `scripts/stop-hook.sh`, with a commit past `main` → exit 2; stderr holds the refusal and "verify failed".
14. The repo, `./dev.sh exec true` → exit 0, at most 0.15 s slower than on the branch's first commit; and the `Stop` hook's `pnpm verify` is green.

## Out of scope

- **Cambusa's `dev.sh`**, which has the same gap: the change goes there through Cambusa's own backlog, by the user.
- **Making a clone runnable** with a stack of its own (decision 1). A probe that needs to run code still uses a throwaway container, as the root `CLAUDE.md` says.
- **A clone taking an absent stack** (decision 3): it writes into itself, not into the repo, and the repo's refusal says how to take the stack back.

## Plan

Not test-first: a shell script with manual checks, which run after the change.

1. The spec (this commit).
2. `dev.sh` and `docker/README.md`; cases 1–14, listed in the commit body.
3. The backlog item leaves.
