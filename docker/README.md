# docker

The dev container, the test browsers' image, and the compose stack that runs them. VS Code drives it through `.devcontainer/devcontainer.json`; the root `CLAUDE.md` says what runs where.

## Setting up (the dev container)

The environment is created by VS Code from `.devcontainer/devcontainer.json`, with the repo in a Docker volume. On the machine:

1. **Windows with a WSL2 distro, Docker Desktop (WSL backend) and VS Code connected to WSL**, with the *Dev Containers* extension.
2. **No other stack of this project running.** The compose project name is fixed (`enardo-packages`), so two clones collide: one environment at a time. From WSL, `docker compose -p enardo-packages down` removes an old stack.
3. **Your own SSH key in WSL's SSH agent.** The container holds no key of its own: VS Code forwards the agent of WSL, as ssh and git would use it on a Linux machine with no container.
   - Run an agent that outlives terminals and that VS Code's server sees, holding the key you push with. With keychain (`sudo apt install keychain`), add to `~/.bashrc` and `~/.profile` (so a non-interactive login sees it): `eval "$(keychain --eval --quiet <key>)"`, where `<key>` is the key's file name in `~/.ssh`. It starts one agent per login session, loads the key (asking for its passphrase once) and exports `SSH_AUTH_SOCK` to every shell.
   - **Restart the WSL distro** so that VS Code's server starts with `SSH_AUTH_SOCK` (restarting a window may keep the old server): `wsl --shutdown` from Windows. It stops the whole WSL2 VM, Docker Desktop's engine and every container included, so run it before the first clone, with nothing running.
   - Check: `ssh-add -l` in a WSL terminal lists the key, and `ssh -T git@github.com` authenticates. In the container, `ssh-add -l` must list the same keys (VS Code forwards `SSH_AUTH_SOCK`, `dev.containers.forwardWSLServices`, on by default); if it finds no agent or no key, check `ssh-add -l` in a new WSL terminal, then restart the distro again.
   - **Accepted risk.** While VS Code is attached, every process in the container, dependencies' scripts and Claude Code included, can use the forwarded keys: with an account-wide key it can push to every repo of the account. It cannot copy a key out of the agent. The allow list of the firewall is not a seal either: GitHub can carry data out.
   - **Ruleset on `main`.** On GitHub, in this repo's settings, add a branch ruleset targeting `main` that blocks deletion and force pushes. A normal push to `main` stays allowed.
4. **`dev.containers.gitCredentialHelperConfigLocation` set to `none`** in VS Code's local user settings, the Windows ones. The setting is machine-scoped and the Dev Containers extension runs on the Windows side, so a window connected to WSL may not list it in the Settings UI: run *Preferences: Open User Settings (JSON)* (not *Remote Settings*) and add `"dev.containers.gitCredentialHelperConfigLocation": "none"`. Its default (`global`) installs a git credential helper that hands the host's HTTPS Git credentials to the container. After the container is up, `git config --show-origin --get-all credential.helper` must show no helper pointing at VS Code's server.
5. **Create it:** *Dev Containers: Clone Repository in Container Volume* with `git@github.com:enriconardo/enardo-packages.git/tree/<branch>` (the branch is optional). The creation enables the firewall, sets `core.hooksPath`, makes a local `main` and runs `pnpm install`. Pushes go through the SSH agent, so `origin` has to be the SSH URL.

The **memory limit** of the WSL2 VM is set once, below. `~/.gitconfig` is copied by VS Code. Claude Code's login lives in the named volume `claude-config`, at `/home/node/.claude`, and survives *Rebuild Container*.

The repo's volume is the only copy of what is not pushed: see *The repo's volume* before removing anything.

## The dev image (`dev/`)

- `node:24-bookworm` with pnpm, plus what the next bullets list; nothing else is added.
- The pnpm store, `.pnpm-store/`, sits in the repo beside `node_modules`, so that packages are hard-linked: deleting it means redownloading everything.
- git comes with that base and must stay: turbo's `--filter=...[main]` resolves the affected packages by diffing against git, inside the container.
- Nothing of the host is mounted: the compose file binds no path, and the container has no Docker socket (a container that can reach the host daemon gives root over the machine). The repo is a volume at `/workspaces/enardo-packages`; the only credential is WSL's SSH agent, forwarded by VS Code (*Setting up*).
- Added to the base (apt): `less sudo iptables ipset iproute2 dnsutils aggregate jq shellcheck`, and Claude Code (native installer, as `node`, updating itself). The publish token is not in the container: the `publish` skill gives the human the commands for WSL.

## RAM of the WSL2 VM

Docker Desktop's containers share the memory of the WSL2 VM, whose limit is `memory=` in `%UserProfile%\.wslconfig` (Windows side; apply it with `wsl --shutdown`, with nothing running):

```
[wsl2]
memory=8GB
```

**Why 8GB.** The peak was measured during the acceptance, with `docker stats --no-stream` from WSL at the peak of `pnpm verify:all --force` in the container (in-memory Mongo and the three browsers): `dev` 4.117GiB and `playwright` 616.9MiB, about 4.7GiB together, with the VM's limit at 11.69GiB. 8GB leaves about 3GiB for VS Code's server, Claude Code and Docker itself. Measure again after a change that adds a heavier test (`docker stats --no-stream` from WSL at the peak of `pnpm verify:all --force`), and raise the value if the peak approaches it.

**Symptoms of too little.** Browser tests failing with a `connectTimeout`, or the OOM killer ending a process (`Killed`, exit 137; `dmesg` in WSL names it).

## The repo's volume

**The volume is the only copy of what is not pushed.** `docker volume rm`, `docker volume prune --all` and Docker Desktop's *Purge data* and *Clean / Purge* remove it: push a branch, work in progress included, before any of these, or before removing the container together with its volume. The `claude-config` volume is separate and only costs a login.

The compose project name is fixed, so one environment of this repo runs per machine. A second clone is an ordinary folder inside the same volume (a worktree works too).

## The firewall

`docker/dev/init-firewall.sh` denies outbound traffic except to an allow list (GitHub's ranges, `registry.npmjs.org`, Anthropic's and Claude's hosts, VS Code's extension hosts, `fastdl.mongodb.org` for the in-memory Mongo), the compose networks and DNS. `node` can run only that script, through one sudoers entry. It runs at creation before `pnpm install` and at every start (`postStartCommand`).

- **Bootstrap and refresh.** On a fresh network it opens, builds the rules and closes; once the rules are in force a run only refreshes the addresses, without opening anything. Every restart is a bootstrap and needs the network and `api.github.com/meta` (unauthenticated).
- **Failure.** A failed bootstrap leaves the policies at DROP, and VS Code reports the failed lifecycle command: fix the cause (offline, GitHub's rate limit, `playwright` stopped: `docker start enardo-packages-playwright-1` from WSL), then run `sudo /usr/local/bin/init-firewall.sh`, **before working**: the next run after a failed one is a bootstrap again.
- **Stale addresses.** A domain is resolved once per run. Connection errors to an allowed host (a CDN changed address) are fixed by `sudo /usr/local/bin/init-firewall.sh`.
- **A missing host.** A blocked extension install, plugin or download means the host is not on the list: add it to the script and rebuild.
- **It limits, it does not seal.** DNS and the allowed hosts, GitHub among them, can carry data out. IPv6 is not filtered, since the network has none.
- **VS Code.** An update needs a new server through the list. Closing the window stops the stack (VS Code's `shutdownAction`) and ends running Claude sessions; the next open is a bootstrap.

## Rebuilds

A change to `dev/Dockerfile`, `playwright/Dockerfile` or `docker-compose.yml` (pulled, or made) is applied by *Dev Containers: Rebuild Container*, which rebuilds both services. It is the only way to apply a new `playwright` image, and nothing notices a Dockerfile that changed by itself. The first build needs the network: there is no fallback for an image that cannot be built.

**After a rebuild that changes the image** (a Dockerfile, a newer `node:24-bookworm`, the compose file): run `pnpm verify:all --force`. Turbo's key holds none of them, so `pnpm verify` would replay results cached on the old image. A new clone starts with an empty cache.

## The `playwright` service (`playwright/`)

The browser tests run in it.

- **What it runs:** Playwright's builds of Chromium, Firefox and WebKit, behind Playwright's `run-server` on port 3000.
- **When it starts:** with the dev container (`depends_on`), since `pnpm verify` runs the browser tests. Closing the VS Code window stops both services.
- **Who reaches it:** its port is not published, so only the dev container reaches it, through the internal `browsers` network (it has no route out), at `ws://playwright:3000/`. The dev container gets that address as `PLAYWRIGHT_WS_ENDPOINT`, and turbo passes it through to `test`. Vitest serves the test pages on the dev container's loopback, and the browsers load them through the connection (`exposeNetwork: "<loopback>"`). Nothing is mounted into it.
- **Versions:** the catalog pins `playwright` to the version in its Dockerfile, so an upgrade changes both. `pnpm verify` compares the two, and the versions the lockfile installs, on every run, outside turbo's cache (`playwright/check-version.sh`). A test run cannot be trusted to catch a mismatch: the server refuses a client of another minor version only (`428`, "Playwright version mismatch"), and turbo can replay a run that passed against a container not yet rebuilt.
- **After a change to its Dockerfile:** run *Rebuild Container* before `pnpm verify`, so that the tests run against the new image. The Dockerfile is a `globalDependencies` entry of `turbo.json`, so the next verify re-runs every package; a run against the old container would be cached under the new key. If a verify already ran before the rebuild, `pnpm verify --force` runs everything again. A change to `docker-compose.yml` alone re-runs nothing: after renaming the service or its endpoint, run *Rebuild Container*, then `pnpm --filter <package> test` for each package with browser tests, which does not go through turbo's cache.
- **When it is down:** a browser test run fails at its connection to `ws://playwright:3000/`, with `getaddrinfo ENOTFOUND playwright` when the service is stopped. `docker start enardo-packages-playwright-1` from WSL starts it again, then `sudo /usr/local/bin/init-firewall.sh` (its address is resolved at the bootstrap).
