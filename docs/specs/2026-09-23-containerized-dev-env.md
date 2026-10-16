---
status: done
type: chore
packages: [repo]
branch: chore/repo/containerized-dev-env
---

# Containerized development environment

## Goal

One containerized environment for all development in this monorepo — shared packages, projects and repo-wide operations — driven from the host by a single script, replacing the two divergent Docker setups that exist today.

## Problem

| | `.devcontainer/` (today) | `docker/cambusa/` (today) |
| --- | --- | --- |
| Purpose | develop the monorepo | develop/run cambusa |
| Base image | `typescript-node:24` (Debian, glibc) | `node:24-alpine` (musl) |
| Mongo | replica set on `27017` | replica set on `27027` |
| Dependencies | `pnpm install` in `postCreateCommand` | `pnpm install` + `packages:build` on every start |

1. Debian and Alpine share the same bind-mounted `node_modules`, but `bcrypt` and `mongodb-memory-server` are native: binaries built under one libc do not work under the other. This is why the cambusa entrypoint reinstalls on every start.
2. `projects/cambusa/.env.development.example` points at `mongodb:27027`, which only exists in the cambusa compose file; from the devcontainer the app cannot reach its database.
3. Dependencies installed on the WSL host and inside a container overwrite each other through the bind mount.
4. Two entry points (VS Code opening a devcontainer, and `app.sh` in a host terminal) make it ambiguous where a given command actually runs — a reliable way to run `pnpm install` in the wrong place.

## Design

### Two layers

- **Development layer**: one long-running `dev` container where every command runs — `pnpm`, `turbo`, `pnpm verify`, `git`, `claude` — for every package and project. Applications run there too, as watch processes (`pnpm cambusa:dev`), so hot reload is immediate and no image is rebuilt per change.
- **Service layer**: per-project backing services (MongoDB for cambusa, more later), declared in the same compose file behind Compose **profiles**, so only what is needed starts.

### One interface: `dev.sh`, from the host

Bare commands act on the development container, the implicit subject; a project name switches the subject to that project's services.

```
./dev.sh up                      # start the development container
./dev.sh shell                   # enter it: pnpm, turbo, verify, git, claude
./dev.sh exec <command>          # run one command inside it
./dev.sh down
./dev.sh clean                   # remove node_modules and dist
./dev.sh cambusa up              # start cambusa's services (profile cambusa)
./dev.sh cambusa logs
./dev.sh cambusa down
```

Since the first argument is either a command or a project name, the two namespaces must not collide: no project may be named `up`, `down`, `shell`, `exec`, `clean`, `logs` or `help`. The script validates this and fails with an explicit message rather than guessing.

The rule this enforces: **the host starts things, the container runs them**. No editor plugin, no second terminal with different semantics. `shell` remains the escape hatch for anything the script does not cover.

VS Code (or any editor) stays on the host and opens the repo normally; *Attach to Running Container* works without any devcontainer configuration for whoever wants the editor inside.

### Layout

```
docker/
  dev/Dockerfile          # node:24 (Debian) + pnpm + git + Claude Code
  docker-compose.yml      # dev service (always) + project services (profiles)
dev.sh                    # the single host-side interface
```

### Key decisions

1. **No `devcontainer.json`.** It is a second entry point into the same container and ties the workflow to one editor. Removing it makes `dev.sh` the only way in.
2. **`node_modules` stays on the bind mount**, not on a named volume: the editor runs on the host and its TypeScript server, ESLint and go-to-definition need to see the dependencies. Installs are somewhat slower through the bind mount; that is the accepted cost. Only the pnpm store (607 MB of downloaded cache, which no editor reads) goes on a named volume. Switching `node_modules` to a volume later is a one-line change in the compose file.
3. **Dependencies are installed only inside the container.** `pnpm install` on the host would mix native binaries (`bcrypt`, `mongodb-memory-server`) built for a different environment. This becomes a rule in `CLAUDE.md`.
4. **No absolute host path anywhere.** Compose resolves relative host paths against the compose file's directory, so the bind mount is `..`, wherever the repo is cloned and on whatever machine. Inside the container the path is fixed at `/workspaces/en-monorepo`, identical for everyone. Cost: Claude Code keys its memory by project path, so the existing memory directory is renamed once during implementation (`-home-enardo-Projects-en-monorepo` → `-workspaces-en-monorepo`).
5. **The Docker socket is not mounted.** A container that can reach the host daemon can start a privileged container with the host filesystem mounted, which is root on the host: any dependency `postinstall` script or agent command would inherit that power. This is precisely why `dev.sh` runs on the host.
6. **UID/GID 1000** match the host user (verified: `enardo` is 1000:1000), so bind-mounted files keep their ownership. `UID`/`GID` build args cover hosts where it differs.
7. **The repo stays in the WSL filesystem.** Docker Desktop runs on the WSL2 backend; a bind mount from NTFS would be markedly slower.
8. **The environment lives in this repo.** A change to it (a Node bump, say) must be branched, specced and verified together with the code that depends on it. If a second repository ever needs the same environment, the artifact to share is a published image, not a second repository.

### Mongo, unified

One MongoDB service per project, named `cambusa-mongodb`, single-node replica set `rs0` on the default port `27017`, reachable by service name on the compose network. `projects/cambusa/.env.development.example` and the local `.env` are aligned to it. Mongo-backed tests do not use it: they run an in-memory replica set via `mongodb-memory-server`, so shared packages need no service at all.

## Scope

1. `docker/dev/Dockerfile`: `node:24-bookworm`, corepack + pnpm, git, Claude Code, non-root user `node`, `UID`/`GID` build args.
2. `docker/docker-compose.yml`:
   - `dev`: relative bind mount `..` → `/workspaces/en-monorepo`, named volume for the pnpm store, mounts for `~/.claude`, `~/.gitconfig` and the SSH agent socket, published ports 3000 and 5183, no Docker socket, `sleep infinity`.
   - `cambusa-mongodb`: profile `cambusa`, replica set `rs0` on 27017, healthcheck that initializes it, named data volume.
3. `app.sh` → `dev.sh`: rewritten as the single host interface with the commands above, reserved-name validation for project names, a clear error when Docker is unreachable or the container is not running, and updated usage text.
4. `projects/cambusa/.env.development.example` and `.env`: `MONGO_DB_URI=mongodb://cambusa-mongodb:27017?replicaSet=rs0`; the committed Mailtrap SMTP credentials are replaced with placeholders.
5. Delete `.devcontainer/` and the old `docker/cambusa/`.
6. `CLAUDE.md`: a "Development environment" section — every command runs inside the dev container, never `pnpm install` on the host, how to start a project stack, the `dev.sh` command list.
7. One-time migration: remove the host `node_modules` and `dist` trees, reinstall inside the container, and rename the Claude memory directory.

## Out of scope

- Any production image or deployment pipeline: to be written when deployment is addressed.
- Extracting the dev image into its own repository or registry.
- Moving the workspace into a container volume.
- Changing any application code.

## Test plan

Verification is manual — this touches the environment, not the code:

1. `./dev.sh up` builds the image and starts the container.
2. `./dev.sh exec pnpm install` completes; `node_modules` is visible from the host and the editor resolves types.
3. `./dev.sh exec pnpm verify:all` is green inside the container, Mongo-backed tests included, with no service running.
4. `./dev.sh cambusa up` starts `cambusa-mongodb` and its healthcheck initializes the replica set.
5. In `./dev.sh shell`, `pnpm cambusa:dev` starts api-server and web; the API answers on `localhost:3000` and the frontend on `localhost:5183` from the Windows browser, and the API connects to Mongo.
6. In the same shell, `git` and `claude` work, and the renamed memory directory is picked up (`MEMORY.md` visible in a session started inside the container).
7. `./dev.sh cambusa down` stops the services and leaves the data volume intact; `./dev.sh down` stops the container without touching the repo.

## Risks

| Risk | Mitigation |
| --- | --- |
| Installing on the host silently breaks native modules | rule in `CLAUDE.md`; `dev.sh` is the obvious path, and `clean` + reinstall is the recovery |
| Installs are slower through the bind mount | accepted; switching `node_modules` to a named volume is a one-line change |
| Container paths (`/workspaces/...`) baked into caches, source maps and `tsbuildinfo` confuse host-side tooling | accepted: only the editor runs on the host, and it does not read those |
| Renaming the Claude memory directory could lose memories | one-time move, verified after the first container start |
| Project services can only be started from the host | accepted deliberately: it is what keeps the Docker socket out of the container |

## Implementation notes

Decided during implementation, after the spec was approved:

1. **The pnpm store is not on a named volume.** It is pinned to `.pnpm-store/` in the repo via `npm_config_store_dir`, because a store on a different filesystem than `node_modules` cannot be hard-linked from and pnpm falls back to copying every package.
2. **Claude Code runs on the host, not in the container.** Inside the container it could not start or stop project services (no Docker socket), which would block any work on a project; it routes package commands through `./dev.sh exec` instead. Consequences: the image holds only Node, pnpm and git; nothing but `~/.gitconfig` is mounted, so no SSH key or credential enters the container; and the Claude memory directory keeps its host path, so the rename in decision 4 was reverted.
3. **Published port is 3010**, the port the api-server actually listens on according to `projects/cambusa/.env`; the env examples said 3000 and were corrected, `VITE_API_BASE_URL` included.
4. **The old pnpm store held `bcrypt` built for musl** by the deleted Alpine container, and the first install reused it, which broke the tests exactly as the problem statement predicted. The store was wiped and repopulated from the container.
5. **The `dev.sh` interface was reworked** after the first review: `up [project] [-d]` starts the dev container and optionally a project's services, attaching a shell unless detached or run without a terminal; `shell` and `logs` take a service; `down` takes everything, a project, or a single service.
