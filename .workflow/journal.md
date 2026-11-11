# Task journal

branch: chore/repo/dev-container-environment
tier: L
phase: l/chunk-3/implement
base: f7495c1
started: 2026-11-11T05:21:04Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

spec: .workflow/specs/2026-11-11-dev-container-environment.md

spec_review_rounds: 4

step_review_rounds: 0

## Intent

### Intent: dev container in which all the work happens, Claude Code included

Tier: L (development environment and workflow), with an ADR for the choice of the dev container and of the repo in a volume. Confirmed by the human ("Tier atteso: L"), not contested.

#### Problem (the human's words)

"Sostituire l'ambiente di sviluppo basato su ./dev.sh con un dev container in cui avviene tutto il lavoro, Claude Code compreso."

Today the tools (node, pnpm, turbo) run in the `dev` container, but editor and Claude Code are on the host. Every command goes through `./dev.sh exec`, and dev.sh filled up with logic that only serves to cross that boundary: signal forwarding with stop-session.sh, the check that the checkout is the mounted one, the clone procedure for worktrees in docker/README.md, the empty PROJECTS.

#### Goal

"Poter aggiornare l'intero ambiente indipendentemente dalla mia macchina."

#### Decisions the human took

- `.devcontainer/devcontainer.json` lives in this repo and reuses docker/docker-compose.yml, including the playwright service as it is. A base common to other projects is extracted into a separate repo only when a second project needs it.
- The repo lives in a Docker volume ("Clone Repository in Container Volume"), not in a folder mounted from the host. "Tutto nasce e muore dentro il container; sull'host servono solo Docker ed editor."
- Claude Code is installed and runs in the container (start from Anthropic's reference dev container, with the firewall for outbound traffic). The login stays in a volume.
- git, commit and push happen from the container with the forwarded SSH agent. The current rule "no credentials in the container" (docker/README.md) is rewritten accordingly.
- pnpm install starts by itself at container creation (postCreateCommand).
- Host: Windows with a WSL2 distro, where the projects are, and Docker Desktop with the WSL backend. VS Code connects to WSL and from there to the container. The SSH key goes in WSL's agent (for example with keychain) and VS Code forwards it.
- Add `.gitattributes` with `* text=auto eol=lf`: the repo has none today, and a CRLF would break bash and shellcheck.

Decided during brainstorming:

- **Publishing: throwaway container.** The dev container builds and packs; the publish skill then shows the human filled-in commands, and the human runs them by hand from a WSL terminal: `docker cp` of the tarball out of the dev container, then a `docker run --rm` of a node image with the tarball and the token (`~/.config/pnpm/auth.ini`) mounted, running pnpm publish at the pinned version. The token never enters the dev container, ADR 0004 holds, the host needs no pnpm. Claude cannot launch these commands: that manual step is the real gate on "each publish approved by the user".
- **No Docker socket in the dev container.** `probe_env` becomes a temporary folder outside the repo, in the dev container (subject to the firewall's allow list). No docker-in-docker.
- **Acceptance before merge, on a pushed branch.** The real flow (Clone in Volume from VS Code, SSH agent, firewall, Claude Code in the container) can only be tested partly from here; the last step is the human's in VS Code. The branch is pushed when the human says so, the human clones it in a volume and runs `verify:all --force` there. dev.sh on main stays valid until that passes.
- **SSH key: a deploy key of this repo**, write access only to enardo-packages, in WSL's agent. It limits what any process in the container can do with the forwarded agent.

#### To remove or simplify

Most of dev.sh (evaluate keeping something, for example clean) and docker/dev/stop-session.sh.

#### To update

The sections of docker/README.md that no longer make sense; root CLAUDE.md (Development environment, every reference to `./dev.sh exec` and to "never pnpm on the host"); every skill, agent or script calling dev.sh (search with git grep).

#### Risks the spec must cover

- The volume is the only copy of unpushed work (docker volume prune).
- The RAM limit of the WSL2 VM (.wslconfig) with in-memory Mongo and the three browsers.
- Turbo's cache after the image changes (verify:all --force).

Noted during exploration: `origin` is an HTTPS URL today, so the volume clone must use the SSH URL and the firewall must open port 22 towards GitHub.

## Open findings

## Lesson candidates

## Backlog candidates

- `verify:all --force` is flaky under parallel packages: 1 run in 3 failed on email-nodemailer's idle SMTP check (a connection reached a server no sender may reach), with `Port already in use` and a mongod invariant failure in the Mongo packages in the same log, neither in the two green runs. Cause suspected (port collisions across packages), not proven. Seen on chunk 2.
- A branch ruleset on `main`, limiting what the deploy key can force-push (spec, Decision 8).

## Log

- 2026-11-11T05:21:04Z opened on f7495c1 of main
- 2026-11-11T05:21:34Z map: /tmp/claude-1000/-home-enardo-Projects-enardo-packages/b788a64e-93ee-4376-8843-5cba6e85a09c/scratchpad/map.md
- 2026-11-11T05:30:01Z human: publish from a throwaway container, commands run by hand from WSL; no docker socket, probe_env a temp folder; acceptance on a pushed branch before merge; SSH key: deploy key of this repo
- 2026-11-11T05:44:17Z spec review round 1: 2 blocking accepted (firewall re-run never opens; C2 and journal), minors accepted; M3 playwright channel stated as accepted risk, owner asked to keep the service as is
- 2026-11-11T05:50:20Z spec review round 2: blocking accepted (A7 tests the skill, skill moved to chunk 3); minors accepted (firewall modes by policy+set, EXIT trap, lock); M5 answered in the ADR as the owner's preference
- 2026-11-11T05:56:05Z spec review round 3: holds, only minors, all fixed
- 2026-11-11T06:03:31Z human at checkpoint: close the playwright channel in this task (internal compose network), overriding 'as it is'
- 2026-11-11T06:09:11Z spec review round 4: holds, only minors, all fixed
- 2026-11-11T06:10:31Z human: spec approved
- 2026-11-11T06:24:13Z chunk 2: verify red at dev.sh's require_this_checkout, not on the code: Docker Desktop reports the compose bind as docker-desktop-bind-mounts/Ubuntu-24.04/<sha256 of the checkout path>, so -ef fails; the stack is this checkout. Spec limits dev.sh to the second -f: asking the human
- 2026-11-11T06:25:32Z human: teach require_this_checkout the docker-desktop-bind-mounts form; spec chunk 2 amended
- 2026-11-11T06:33:08Z chunk 2 step review round 1: changes required (UID/GID remap still present, false 'no longer exists' hint on Docker Desktop, symlink refused); reviewer's H3 sudo probes denied by the permission classifier, H3 not independently run
- 2026-11-11T06:44:27Z chunk 2 step review round 2: ok; H1 86/86 on runs 2 and 3 after one flaky run, H2, H3 and H5 reported by the implementer on the rebuilt image
