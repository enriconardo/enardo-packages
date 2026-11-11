# 0022. The work happens in a dev container, with the repo in a Docker volume

- Status: accepted
- Date: 2026-11-11
- Spec: `.workflow/specs/2026-11-11-dev-container-environment.md`

## Context

The tools ran in a `dev` compose service, the editor and Claude Code on the host, and every command crossed the boundary through `./dev.sh exec`. The script had filled up with logic that served only that crossing: forwarding signals to a session in the container (`docker/dev/stop-session.sh`), refusing a checkout other than the mounted one, a clone procedure for worktrees. The environment also depended on what the host had installed.

The goal is to update the whole environment independently of the machine. The host is Windows with a WSL2 distro and Docker Desktop on the WSL backend, and VS Code reaches the container through WSL.

## Decision

1. **All the work happens in a dev container**, defined by `.devcontainer/devcontainer.json` on top of `docker/docker-compose.yml`, the `playwright` service included. The host needs Docker and an editor, plus what cannot live in the container: the SSH agent with the developer's keys, the publish token, VS Code's settings and the VM's memory limit. A base shared with other projects is extracted only when a second project needs it.
2. **The repo lives in a Docker volume** ("Clone Repository in Container Volume"), not in a folder mounted from the host. The compose file binds nothing of the host.
3. **Claude Code runs in the container**, behind a default-deny outbound firewall derived from Anthropic's reference dev container. Only root can change the rules. The user `node` can only re-run the script, and once the firewall is up a re-run refreshes the addresses of the allow list without opening it. Only after a failed start, which is reported, does the next run start from open egress. Its login is in a named volume.
4. **git runs in the container, with WSL's SSH agent forwarded, holding the developer's own keys.** This replaces the rule "no credential in the container". The container holds no key: VS Code forwards the agent, as ssh would on a Linux machine, and its forwarding of the host's HTTPS Git credentials is off. While VS Code is attached, every process in the container can use the forwarded keys, so an account-wide key lets a compromised dependency, or Claude Code, push to every repo of the account; it cannot copy a key out. The owner accepts that risk. A branch ruleset on `main` of this repo blocks its deletion and force-pushes. Under `dev.sh`, which has no firewall, Claude's login volume is covered by a `tmpfs`.
5. **The publish token never enters the dev container.** The dev container packs; the human runs the registry commands from WSL, in a throwaway container with only the tarball and the token mounted. This replaces the place ADR 0004's consequences gave the publish step, the host's pnpm, and narrows "never enters a container" to the containers where dependencies' code runs.
6. **The dev container has no access to Docker.** A socket is root on the host and goes around the firewall. So nothing in the container can start the publish, which makes the human's approval a real gate rather than a rule.

## Consequences

- `dev.sh` and `docker/dev/stop-session.sh` are gone, and with them the checkout guard and the clone procedure for worktrees: a worktree is an ordinary folder in the volume.
- The volume is the only copy of what is not pushed. Removing it (`docker volume rm`, `docker volume prune --all`, Docker Desktop's *Purge data*, *Clean / Purge*) loses that work: unpushed work is pushed to a branch before any of these.
- A compose project has a fixed name, so one dev container of this repo runs at a time on a machine.
- Whatever the dev container reaches has to be on the firewall's allow list. A domain is resolved when the script runs, so a CDN that changes address can start refusing connections until the script is re-run.
- Probes run in a temporary folder of the dev container, under the same allow list. A probe of anything else runs from WSL.
- Publishing costs a few commands pasted in a WSL terminal: the copy of the tarballs, then one throwaway container each for the login check, the dry run and every publish.
- The firewall limits, it does not seal. DNS and the allowed hosts, GitHub among them, remain ways out. The `playwright` service has none: it is only on an internal compose network shared with `dev`. With the forwarded keys a process in the container can push, while VS Code is attached, wherever those keys can; the ruleset keeps `main` of this repo from being rewritten or deleted.

## Alternatives considered

- **Keep `dev.sh`**: the boundary stays, and the environment keeps depending on the host.
- **The repo bound from WSL in the container** (*Reopen in Container*): it removes `dev.sh` too, with no volume to lose. It also keeps a copy on the host and avoids the volume's costs: the only-copy risk, a compose file that binds nothing and depends on the extension injecting the volume. The volume buys one thing beyond it: nothing of the work is in WSL, so a machine needs no checkout, and the environment is whatever the repo defines. That is the owner's preference, stated as such; speed was not measured.
- **The publish token in the dev container**: shorter, but every `lint`, `test` and `build` runs dependencies' code that could read it, and a published version cannot be taken back. The registry would have to be on the allow list, so the firewall would not stop it.
- **pnpm in WSL for the publish**: works, and keeps a tool on the host.
- **The Docker socket, or Docker-in-Docker, for throwaway probes**: the first is root on the host and goes around the firewall; the second needs a privileged container and more of the VM's memory.
- **WSL's SSH agent forwarded, holding only a deploy key of this repo**: the first choice. It limits the forwarded keys to one repo, but keeps a key and an agent apart from the account key in WSL, and a setup to repeat per project; the acceptance found the account key in the same agent through `AddKeysToAgent`, which nothing in the container notices.
- **A key of the container's own, added as a deploy key, with ssh ignoring the forwarded agent** (`IdentityAgent none`): git then depends on nothing of the host, and a push reaches only this repo, but the key is a file that can be copied out, and a forwarded agent stays usable through its socket unless the host keeps it empty. Weighed during the acceptance and left for later.
