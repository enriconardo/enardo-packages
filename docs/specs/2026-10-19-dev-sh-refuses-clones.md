---
status: done
type: chore
packages: []
branch: chore/repo/dev-sh-refuses-clones
---

# `./dev.sh` drives the dev container only from the checkout it mounts

## Why

Many probes run on a clone: a second copy of the repo, made with `git clone` in a scratch directory, where an agent tries a wrong implementation, a mutant or a changed script without touching the working tree. The root `CLAUDE.md`, the `reviewer`, the `spec` skill and past specs prescribe it.

Every clone holds its own `dev.sh` and `docker/docker-compose.yml`, and the compose file fixes the project's name (`name: enardo-packages`). So every checkout's `./dev.sh` drives the same containers, and the dev container mounts the checkout that started it. From a clone:

- `exec` and `shell` run on the mounted checkout's tree: a probe reads the results of code other than the clone's, and what it writes lands in the tree the clone was meant to protect;
- `up` recreates the dev container with the clone's mount, stopping what ran in it; from then on, the repo's own `./dev.sh exec` runs in the clone, and nothing says so;
- `down` stops the stack.

It happened in the first review of `chore/repo/test-handoff-and-idle-verify`: a hook probe on a clone ran the real `pnpm verify` against the repo's tree. That verify only read; a probe that writes would have written there.

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
- `./dev.sh exec true` on this branch's first commit: 0.56–0.63 s. `compose ps -q dev`, which `require_running` already runs, takes 0.1 s: the check adds one more `compose ps` and an `inspect`, about 0.14 s.
- A clone's code in a throwaway container of the dev image, the clone mounted at `/workspaces/enardo-packages`, with `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` → `pnpm install --frozen-lockfile` and `pnpm --filter @enardo/errors test` pass in 31 s; `node_modules` belongs to the host user, the store is the clone's own `.pnpm-store/`, and the clone's `git status` stays clean.
- The same container on the stack's network (`--network enardo-packages_default -e PLAYWRIGHT_WS_ENDPOINT=ws://playwright:3000/`), on a clone with a commit that touches `@enardo/http-client` → `pnpm verify` passes, 6 tasks in 26 s, the browser tests against the stack's `playwright`; the stack's containers keep their IDs, and the `git status` of the clone and of the repo stay empty. With the stack stopped → `getaddrinfo ENOTFOUND playwright`.
- A clone of the repo while the repo is on a branch has no local `main`: `git clone` creates the source's current branch only. `pnpm verify` then fails in turbo's `--filter=...[main]`; after `git branch main origin/main` it passes.
- `docker run -v` of a host path that does not exist → Docker creates it, a directory owned by root, which the host user cannot remove.
- Without `name:`, `compose config` gives `name: docker`, the compose file's directory. `COMPOSE_PROJECT_NAME=x`, in the environment or in `docker/.env`, gives `name: x`, over `name:`. `git clone <repo>` with no target creates a directory `enardo-packages`.
- `scripts/integrate.sh`, like the `Stop` hook, runs `./dev.sh exec pnpm verify` on the host before it merges.
- `.claude/settings.json` runs the `Stop` hook as `"${CLAUDE_PROJECT_DIR:-.}"/scripts/stop-hook.sh`: a session's own checkout, not a clone it works in.
- Cambusa's `dev.sh` has the same `ROOT_DIR` and `require_docker`, and its compose a fixed `name: cambusa`; its backlog has no item on clones.

## Decisions

1. **What tells the checkouts apart: the source of the dev container's bind mount at its working directory**, compared with `ROOT_DIR` as the same file (`-ef`). It is the tree that `exec` and `shell` run in, whatever the path is called: a symlink to the checkout passes, a clone or a worktree does not, and neither does a checkout nested inside the mounted one. Reading the destination from the container's `WorkingDir`, rather than naming `/workspaces/enardo-packages`, keeps the check true to a container started before a rename of the mount point. Not chosen:
   - **the compose label `com.docker.compose.project.working_dir`**, the directory of the compose file that created the container: it says which checkout started it, not which tree commands run in;
   - **a marker file**, written by `dev.sh` and looked for through `exec`: it would survive a translated path, which Docker Desktop does not produce (probed), and it writes into the tree and costs an `exec` on every call;
   - **a compose project per checkout**, named after its path: each clone gets a stack of its own, so nothing needs refusing. It renames the repo's stack, its containers and images, and a clone's `up` starts a second dev container and a second set of browsers. The item asks for a refusal.
   - **no `name:` in the compose file**: every checkout's project is then `docker` (probed), the same for all. Named after the checkout's directory instead, a plain `git clone <repo>` gets `enardo-packages`, the repo's own name (probed).
   - **a project name from a variable** (`COMPOSE_PROJECT_NAME`, which overrides `name:`, probed): it protects only a checkout that sets it, and the default stays the shared stack.
   - **a script that creates the clones of probes**, each with a project of its own in its `docker/.env`, judged by the `critic` at the user's request. It protects only the clones it creates, and adds what no probe has needed so far: a stack per clone, with browsers of its own (0.7 GiB once they ran) and an install from an empty store (38.6 s). The probes on copies so far all ran in throwaway containers of the dev image, which the README's command keeps doing, the browser tests included. Not queued (user).
2. **Every command that reaches Docker checks: `up`, `shell`, `exec`, `logs`, `down`.** `help` reaches nothing, and `clean` acts on `ROOT_DIR` only, which is right in a clone. `logs` only reads, but one rule for every command that calls Docker is easier to keep than a list of the dangerous ones. The check runs after `require_docker`, so an unreachable Docker still says so first.
3. **Only an existing dev container is compared, running or stopped.** `up` recreates a stopped one too (probed). With none, nothing is refused: `up` creates it with this checkout's mount, and the other checkouts are refused until it goes. A clone can take the stack this way only while it is down, and its writes then land in the clone. The `playwright` service mounts nothing and is not compared.
4. **The refusal names both paths, and offers no way to take the stack while the mounted checkout exists**, on stderr, with exit 1 like `dev.sh`'s other failures. Its readers are mostly agents probing on a clone, and a hint they follow should not move the stack or reach the repo's tree:
   - it says that `./dev.sh` drives the container only from the checkout it mounts, and that another checkout's code runs in a throwaway container of the dev image, as `docker/README.md` shows;
   - when the mounted checkout no longer exists on the host (a deleted scratchpad clone), it adds `docker compose -p <project> down`, which works without the compose file (probed), the project read from the container's `com.docker.compose.project` label.

   Not chosen: that hint in every refusal, which hands a refused clone the stack, through a `down` and then its own `up`; and "run `./dev.sh down` from the mounted checkout", which sends a clone to stop the stack from the repo. Whoever wants the stack back from a clone that still exists runs `./dev.sh down` in that clone.
5. **No ADR.** The rule belongs to one script, which enforces it, and `docker/README.md` states it; no other task has to respect it.

## Changes

- **`dev.sh`**: a function that finds the dev container (`compose ps -a -q`), reads the source of its mount at its working directory and its project label (one `docker inspect`), and exits 1 with the message of decision 4 unless that source `-ef` `ROOT_DIR`. A container without such a mount is refused too, with a message saying so. `up`, `shell`, `exec`, `logs` and `down` call it after `require_docker`.
- **`docker/README.md`**: a section saying that `./dev.sh` drives the stack only from the checkout the dev container mounts, what it compares, that the first checkout to `up` an absent stack holds it, and how to free a stack whose checkout is gone. It gives the command that runs another checkout's code in a throwaway container of the dev image, on the stack's network so that the browser tests reach its `playwright` service, and the `git branch main origin/main` that `pnpm verify` needs in a clone made from a branch, as probed. The clone has to exist first: Docker creates a missing source as a directory owned by root (probed). It says that the check is `dev.sh`'s: `docker compose` run by hand from another checkout still drives the stack, the fallback of *When its image cannot be built* included.
- **`docs/backlog.md`**: the item leaves, in a commit of its own.

The `Stop` hook and `scripts/integrate.sh` do not change. In a clone, their `./dev.sh exec pnpm verify` is refused, where it used to verify the shared tree: the hook exits 2 with the refusal on stderr, and `integrate.sh` stops before it merges.

## Test cases

A shell script, which the repo tests with shellcheck only: each case is a manual check, listed in the commit body. They run on two clones A and B of the branch in the scratchpad, whose compose `name` is changed to `en-probe` and committed (a worktree checks out the committed file), so that no case can reach the repo's stack, even under a wrong implementation. Before each case, A's stack is up unless the case says otherwise; each one records the dev container's ID, status and mount before and after. Cases 3, 5 and 9 run first on this branch's first commit, where they do what *Probes* shows.

1. A, `exec git branch --show-current` → A's branch, exit 0.
2. A, through a symlink to A, the same → A's branch, exit 0.
3. B, `exec git branch --show-current` → exit 1, the message names B and A and points to a throwaway container, with no `docker compose … down`; git prints nothing.
4. B, `shell` and `shell playwright` → refused as in 3; no shell opens.
5. B, `up -d` → refused; the dev container keeps its ID.
6. B, `logs` and `logs playwright` → refused, without following any log.
7. B, `down` and `down dev` → refused; both of A's containers still run.
8. B, `help` → the usage, exit 0; B, `clean`, with a `dist/` in a package of A and of B → B's removed, A's kept.
9. A's dev container stopped: B, `up -d` → refused, the container keeps its ID and stays stopped; then A, `up -d` → it runs again, mounting A.
10. No dev container (`docker compose -p en-probe rm -sf dev`): B, `up -d` → creates it, mounting B; then A, `exec true` → refused, the message names A and B, with no `docker compose … down`; then B is removed: A, `exec true` → refused, the message says that B no longer exists and gives `docker compose -p en-probe down`; that command → the stack is gone; A, `up -d` → mounting A. B is cloned again for the next cases.
11. A worktree of A inside A (`git -C A worktree add .wt`), `exec true` → refused: a checkout nested in the mounted one.
12. B, `DOCKER_HOST=unix:///nonexistent ./dev.sh exec true` → "Docker is not reachable", exit 1: the reachability check comes first.
13. B, its own `scripts/stop-hook.sh`, with a commit past `main` → exit 2; stderr holds the refusal and "verify failed".
14. The repo, `./dev.sh exec true` → exit 0, at most 0.2 s slower than on the branch's first commit (0.14 s expected, *Probes*); and the `Stop` hook's `pnpm verify` is green.
15. The README's command, as written, on a clone of the repo with a commit that touches a package with browser tests → that clone's `pnpm verify` passes; the repo's containers keep their IDs, and the repo's `git status` stays empty.

## Out of scope

- **Cambusa's `dev.sh`**, which has the same gap: the change goes there through Cambusa's own backlog, by the user.
- **Making a clone runnable** with a stack of its own (decision 1). A clone's code runs in a throwaway container of the dev image, as the specs of `chore/repo/adapter-drivers` and `chore/email-nodemailer/nodemailer-10` did; `docker/README.md` gives the command.
- **`docker compose` run by hand from another checkout**, which no check of `dev.sh` reaches; the README says so.
- **A clone taking an absent stack** (decision 3): it writes into itself, not into the repo, and the repo's refusal says how to take the stack back.

## Plan

Not test-first: a shell script with manual checks, which run after the change.

1. The spec (this commit).
2. `dev.sh` and `docker/README.md`; cases 1–15, listed in the commit body.
3. The backlog item leaves.
