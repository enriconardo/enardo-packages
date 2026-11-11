---
name: publish
description: Pack and publish `@enardo/*` packages to the private registry, when the user asks to publish or release a package. Holds the registry rules, the pack step in the dev container and the publish commands the human runs from WSL. Every publish is approved by the user.
argument-hint: "<package...>"
---

# Publishing packages

## The registry

- The packages are published to the private Verdaccio registry `https://npm.enriconardo.com`, which needs a token to read and to publish.
- Each manifest pins it with `publishConfig.registry`. With `pnpm publish`, it wins over `--registry` and over the scope's registry, so a publish never reaches the public npm registry. `npm publish` lets `--registry` and the scope's registry override it: **never publish with npm.**
- Only the user's account can publish or unpublish `@enardo/*`. A project installs with the token of a read-only user, kept in that project's dev environment.
- The publish token never enters the dev container, where dependencies' code runs, and the container has no Docker: **Claude cannot launch the registry commands.** The dev container packs; the human runs the commands of *Steps* in a WSL terminal, in a throwaway container with only the tarballs and `~/.config/pnpm/auth.ini` mounted read-only. The published versions of a package are read the same way, by the human in WSL (the registry is outside the container's firewall and the token is not in there, and WSL has no pnpm of its own): the *Check the login* command with `view <package> versions` in place of `whoami`.

## Versions

A published version never changes: a change to a published package ships under a new `version`. A project on `^x.y.z` takes a minor or a patch when it updates, so a breaking change is a new major. Below 1.0.0 the caret is narrower: `^0.1.0` takes patches only, so a breaking change to a 0.x package is a new minor.

## Steps

Fill in `<pnpm>` with the version of the root `packageManager`, without its `+sha512...` (`npx` does not check that hash; say so), and `<tarball>` with a tarball name of `/tmp/enardo-pack`. Show the human the filled-in commands; do not run them.

1. **Pack, in the dev container**, after a fresh build of the package and its dependencies:

   ```sh
   pnpm exec turbo run build --filter=<package>... --force
   pnpm --filter <package> pack --pack-destination /tmp/enardo-pack
   ```

   Clear the folder once before the first pack of the run (`rm -rf /tmp/enardo-pack`), not before each package: with several packages, repeat the build and the pack for each, and the tarballs add up there.

   `pack` turns `workspace:^` into a caret range on the current version, and `catalog:` into its range. The tarball is produced in the dev container: the human inspects it with `tar tzf` before publishing.

2. **Copy the tarballs, in a WSL terminal:**

   ```sh
   mkdir -p ~/enardo-publish && docker cp -a enardo-packages-dev-1:/tmp/enardo-pack/. ~/enardo-publish/
   ```

3. **Check the login, in a WSL terminal.** This command and the dry run and publish check that the auth file exists first, because a missing bind source would be created as a directory:

   ```sh
   test -f ~/.config/pnpm/auth.ini && docker run --rm --user node \
     -v ~/.config/pnpm/auth.ini:/home/node/.config/pnpm/auth.ini:ro \
     node:24-bookworm npx -y pnpm@<pnpm> whoami --registry https://npm.enriconardo.com    # answers enardo
   ```

   If the file is missing, or it does not answer, the human logs in. This one does not check the file, since it creates it: the folder is created beforehand, mounted read-write, and the container is interactive.

   ```sh
   mkdir -p ~/.config/pnpm && docker run --rm -it --user node \
     -v ~/.config/pnpm:/home/node/.config/pnpm \
     node:24-bookworm npx -y pnpm@<pnpm> login --registry https://npm.enriconardo.com
   ```

4. **Dry run**, same container as the check, with `-v ~/enardo-publish:/pack:ro` added and `-w /pack`, and the auth file test first: `npx -y pnpm@<pnpm> publish /pack/<tarball> --registry https://npm.enriconardo.com --no-git-checks --dry-run` shows the registry each tarball goes to.

5. **Publish**, once the user approves: the same command without `--dry-run`, one tarball at a time, in dependency order. A publish is outward-facing: the user approves each one. A package goes after every `@enardo/*` package it depends on whose current version is not on the registry yet: `pack` wrote a range on that version, which resolves to nothing until it is published, and the dry run does not check it.

6. **Clean up:** `rm -rf ~/enardo-publish`, and `/tmp/enardo-pack` in the dev container.
