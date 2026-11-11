# enardo-packages

Reusable TypeScript infrastructure packages (`@enardo/*`), published to a private registry. Each package's README documents its API.

## Setup

The work happens in a dev container with the repo in a Docker volume. On Windows with a WSL2 distro, Docker Desktop and VS Code connected to WSL, run *Dev Containers: Clone Repository in Container Volume* with `git@github.com:enriconardo/enardo-packages.git`. [docker/README.md](docker/README.md) has the one-time setup (the SSH agent, VS Code's settings, the memory limit) and describes the containers.

Creating the container sets the git hooks (the `commit-msg` hook refuses a subject over 72 characters, on commit and merge), enables the firewall and runs `pnpm install`. Then, in its terminal:

```sh
pnpm verify
```

Run it before merging.

## Conventions

[CLAUDE.md](CLAUDE.md) holds the repo's conventions and workflow, for people and agents alike: the layout, branch names (`<type>/<scope>/<description>`), commit messages (`[<scope>] <type>: <summary>`), the code and test conventions, and where tasks run: Workflow Overload (`/overload`).
