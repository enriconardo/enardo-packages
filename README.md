# enardo-packages

Reusable TypeScript infrastructure packages (`@enardo/*`), published to a private registry. Each package's README documents its API.

## Setup

1. Enable the git hooks, once per clone:

   ```sh
   git config core.hooksPath .githooks
   ```

   The `commit-msg` hook refuses a subject over 72 characters, on commit and merge.

2. Start the dev container and install, through `./dev.sh` (`./dev.sh help` lists its commands):

   ```sh
   ./dev.sh up -d
   ./dev.sh exec pnpm install
   ```

   Every command that touches `node_modules` runs in the container. **Never run `pnpm` on the host**: native modules installed from two environments into one `node_modules` break. [docker/README.md](docker/README.md) describes the containers.

3. Before merging, `./dev.sh exec pnpm verify`.

## Conventions

[CLAUDE.md](CLAUDE.md) holds the repo's conventions and workflow, for people and agents alike: the layout, branch names (`<type>/<scope>/<description>`, started with `scripts/task-start.sh`), commit messages (`[<scope>] <type>: <summary>`), the code and test conventions, and how a task goes from spec to merge.
