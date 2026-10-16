---
name: publish
description: Pack and publish `@enardo/*` packages to the private registry, when the user asks to publish or release a package. Holds the registry rules, the pack step in the dev container and the publish step on the host. Every publish is approved by the user.
argument-hint: "<package...>"
---

# Publishing packages

## The registry

- The packages are published to the private Verdaccio registry `https://npm.enriconardo.com`, which needs a token to read and to publish.
- Each manifest pins it with `publishConfig.registry`. With `pnpm publish`, it wins over `--registry` and over the scope's registry, so a publish never reaches the public npm registry. `npm publish` lets `--registry` and the scope's registry override it: **never publish with npm.**
- Only the user's account can publish or unpublish `@enardo/*`. A project installs with the token of a read-only user, kept in that project's dev environment.

## Versions

A published version never changes: a change to a published package ships under a new `version`. A project on `^x.y.z` takes a minor or a patch when it updates, so a breaking change is a new major. Below 1.0.0 the caret is narrower: `^0.1.0` takes patches only, so a breaking change to a 0.x package is a new minor.

## Steps

1. **Pack, in the dev container**, after a fresh build of the package and its dependencies:

   ```sh
   ./dev.sh exec pnpm exec turbo run build --filter=<package>... --force
   ./dev.sh exec pnpm --filter <package> pack --pack-destination <dir>
   ```

   `<dir>` is a folder in the repo, the only one the container and the host share; remove it after the publish. `pack` turns `workspace:^` into a caret range on the current version, and `catalog:` into its range.

2. **Check the login, on the host, from outside the repo**, where pnpm touches no `node_modules` (the one exception to "never run `pnpm` on the host"):

   ```sh
   pnpm whoami --registry https://npm.enriconardo.com    # answers enardo
   ```

   If it does not, the user logs in with `pnpm login --registry https://npm.enriconardo.com`, which pnpm keeps in `~/.config/pnpm/auth.ini`. The publish token never enters a container.

3. **Dry run**, from outside the repo: `pnpm publish <tarball> --dry-run` shows the registry each tarball goes to.

4. **Publish**, once the user approves: `pnpm publish <tarball>`. A publish is outward-facing: the user approves each one.
