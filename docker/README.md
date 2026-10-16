# docker

The dev container, the test browsers' image, and the compose stack that runs them. `./dev.sh` drives it; the root `CLAUDE.md` says what runs where.

## The dev image (`dev/`)

- `node:24-bookworm`, plus pnpm and shellcheck; nothing else is added.
- git comes with that base and must stay: turbo's `--filter=...[main]` resolves the affected packages by diffing against git, inside the container.
- Nothing sensitive is mounted: no Docker socket (a container that can reach the host daemon is root on the host), no SSH key, no credentials. Only `~/.gitconfig`, read-only. Pushing and authenticating happen on the host.

## Rebuilds

`./dev.sh up` rebuilds an image when its Dockerfile (`dev/`, `playwright/`) changed. A rebuilt `playwright` image recreates that service only, not the dev container.

## The `playwright` service (`playwright/`)

The browser tests run in it.

- **What it runs:** Playwright's builds of Chromium, Firefox and WebKit, behind Playwright's `run-server` on port 3000.
- **When it starts:** with the dev container (`depends_on`), since `pnpm verify` runs the browser tests. `./dev.sh down dev` leaves it running.
- **Who reaches it:** its port is not published, so only the compose network reaches it, at `ws://playwright:3000/`. The dev container gets that address as `PLAYWRIGHT_WS_ENDPOINT`, and turbo passes it through to `test`. Vitest serves the test pages on the dev container's loopback, and the browsers load them through the connection (`exposeNetwork: "<loopback>"`). Nothing is mounted into it.
- **Versions:** the catalog pins `playwright` to the version in its Dockerfile, so an upgrade changes both. `pnpm verify` compares the two, and the versions the lockfile installs, on every run, outside turbo's cache (`playwright/check-version.sh`). A test run cannot be trusted to catch a mismatch: the server refuses a client of another minor version only (`428`, "Playwright version mismatch"), and turbo can replay a run that passed against a container not yet rebuilt.
- **After a change to its Dockerfile:** run `./dev.sh up -d` before `pnpm verify`, so that the tests run against the new image. The Dockerfile is a `globalDependencies` entry of `turbo.json`, so the next verify re-runs every package; a run against the old container would be cached under the new key. If a verify already ran before the rebuild (the `Stop` hook runs one at the end of every turn), `pnpm verify --force` runs everything again. A change to `docker-compose.yml` alone re-runs nothing: after renaming the service or its endpoint, run `./dev.sh up -d`, then `pnpm --filter <package> test` for each package with browser tests, which does not go through turbo's cache.
- **When it is down:** a browser test run fails at its connection to `ws://playwright:3000/`, with `getaddrinfo ENOTFOUND playwright` when the service is stopped. `./dev.sh up -d` starts it again.
- **When its image cannot be built** (the first pull of Playwright's 2.5 GB image, offline), `./dev.sh up` stops before the dev container starts. `DEV_UID=$(id -u) DEV_GID=$(id -g) docker compose -f docker/docker-compose.yml up -d --no-deps dev` starts the dev container alone. The browser tests then fail whenever they run, so `pnpm verify` is red when it re-runs the tests of a package that has them; a run turbo has cached replays as it passed.
