# docker

The dev container, the test browsers' image, and the compose stack that runs them. `./dev.sh` drives it; the root `CLAUDE.md` says what runs where.

## The dev image (`dev/`)

- `node:24-bookworm`, plus pnpm and shellcheck; nothing else is added.
- git comes with that base and must stay: turbo's `--filter=...[main]` resolves the affected packages by diffing against git, inside the container.
- Nothing sensitive is mounted: no Docker socket (a container that can reach the host daemon is root on the host), no SSH key, no credentials. Only `~/.gitconfig`, read-only. Pushing and authenticating happen on the host.

## One checkout drives the stack

The compose project has a fixed name, so a clone or a worktree of the repo would drive the same containers: its `./dev.sh exec` would run in the tree the dev container mounts, and its `./dev.sh up` would recreate the container on the clone. So `up`, `shell`, `exec`, `logs` and `down` first compare the dev container's mount at its working directory with the checkout `./dev.sh` runs from, as the same directory (a symlink passes), and refuse any other. `help` and `clean` do not check.

- **With no dev container**, before the first `up` or after a `down`, nothing is compared: the first checkout to run `./dev.sh up` holds the stack, and the others are refused until it runs `./dev.sh down`.
- **When the mounted checkout no longer exists**, such as a deleted clone, the refusal gives the command that removes the stack: `docker compose -p enardo-packages down`.
- **The check is `dev.sh`'s.** `docker compose` run by hand from another checkout still drives the stack, the fallback of *When its image cannot be built* included: run it from the mounted checkout.

### Another checkout's code

It runs in a throwaway container of the dev image, with a clone mounted in place of the repo:

```
git -C <clone> branch main origin/main    # for pnpm verify, when the clone has no main
docker run --rm --network enardo-packages_default -e PLAYWRIGHT_WS_ENDPOINT=ws://playwright:3000/ \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 -e npm_config_store_dir=/workspaces/enardo-packages/.pnpm-store \
  -v <clone>:/workspaces/enardo-packages -w /workspaces/enardo-packages \
  enardo-packages-dev sh -c 'pnpm install --frozen-lockfile && pnpm verify'
```

- **`<clone>` is an absolute path that exists**: Docker creates a missing one as a directory owned by root, which the host user cannot remove.
- **A clone, not a worktree**: a worktree's `.git` names its repository by a host path, which the container does not have (`fatal: not a git repository`).
- **The install stays in the clone**: `node_modules` and the pnpm store, set as in the compose file, are the clone's, owned by the host user, so the next run reuses them. The first install takes about 40 s.
- **The browser tests use the stack's `playwright` service**, through its network: the stack has to be up. That service mounts nothing. A `./dev.sh down` while such a container runs leaves the network behind (`Resource is still in use`, exit 0), and the next `up` reuses it.
- **A clone made while the repo is on a branch has no local `main`**, which `pnpm verify` diffs against: hence the `git branch` line.

## Rebuilds

`./dev.sh up` rebuilds an image when its Dockerfile (`dev/`, `playwright/`) changed. A rebuilt `playwright` image recreates that service only, not the dev container.

## The `playwright` service (`playwright/`)

The browser tests run in it.

- **What it runs:** Playwright's builds of Chromium, Firefox and WebKit, behind Playwright's `run-server` on port 3000.
- **When it starts:** with the dev container (`depends_on`), since `pnpm verify` runs the browser tests. `./dev.sh down dev` leaves it running.
- **Who reaches it:** its port is not published, so only the compose network reaches it, at `ws://playwright:3000/`. The dev container gets that address as `PLAYWRIGHT_WS_ENDPOINT`, and turbo passes it through to `test`. Vitest serves the test pages on the dev container's loopback, and the browsers load them through the connection (`exposeNetwork: "<loopback>"`). Nothing is mounted into it.
- **Versions:** the catalog pins `playwright` to the version in its Dockerfile, so an upgrade changes both. `pnpm verify` compares the two, and the versions the lockfile installs, on every run, outside turbo's cache (`playwright/check-version.sh`). A test run cannot be trusted to catch a mismatch: the server refuses a client of another minor version only (`428`, "Playwright version mismatch"), and turbo can replay a run that passed against a container not yet rebuilt.
- **After a change to its Dockerfile:** run `./dev.sh up -d` before `pnpm verify`, so that the tests run against the new image. The Dockerfile is a `globalDependencies` entry of `turbo.json`, so the next verify re-runs every package; a run against the old container would be cached under the new key. If a verify already ran before the rebuild, `pnpm verify --force` runs everything again. A change to `docker-compose.yml` alone re-runs nothing: after renaming the service or its endpoint, run `./dev.sh up -d`, then `pnpm --filter <package> test` for each package with browser tests, which does not go through turbo's cache.
- **When it is down:** a browser test run fails at its connection to `ws://playwright:3000/`, with `getaddrinfo ENOTFOUND playwright` when the service is stopped. `./dev.sh up -d` starts it again.
- **When its image cannot be built** (the first pull of Playwright's 2.5 GB image, offline), `./dev.sh up` stops before the dev container starts. `DEV_UID=$(id -u) DEV_GID=$(id -g) docker compose -f docker/docker-compose.yml up -d --no-deps dev` starts the dev container alone. The browser tests then fail whenever they run, so `pnpm verify` is red when it re-runs the tests of a package that has them; a run turbo has cached replays as it passed.
