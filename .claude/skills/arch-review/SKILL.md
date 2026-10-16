---
name: arch-review
description: Architectural assessment of one package of this repo (`@enardo/*`), when the user asks for an architectural review, assessment or analysis of a package, or a backlog item calls for one. Read-only: it judges the package's design, finds bugs, ranks the problems by severity, and drafts a package `CLAUDE.md` and backlog items. Not for reviewing a diff or a branch, which is the `reviewer` subagent's job.
argument-hint: "<package>"
---

# Architectural assessment of a package

The package to assess: `$ARGUMENTS`. If that is empty, ask the user which package.

Applications are built on these packages, and the user wants them structurally sound. Your job is an honest judgment of the package's design, grounded in its code and in probes: what holds, what breaks, what to change, in what order. Use the community's best practices as a guide, not as a rule: something is a problem when it costs this package or its consumers something, not because it is done differently elsewhere.

## 1. Find the package

- Its folder: `git grep -l '"name": "<package>"' -- '*package.json'`.
- Its kind, which decides the conventions that apply: shared contract, shared adapter (`<name>-<technology>`), other shared library, config package.
- Its branch scope, as *Branches* in the root `CLAUDE.md` defines it: the name without `@enardo/` (`uow-repository`).
- A former name: the command below prints the renames of its manifest, newest first, and stops at its creation. `--follow` also follows a manifest created as a copy of another package's, and `--diff-filter=R` would then print that package's renames: the `awk` stops at the first line that is not a rename.

  ```sh
  git log --follow --name-status --format= -- <folder>/package.json | grep -v -E '^(M|$)' | awk '!/^R/{exit} {print}'
  ```

  This repo starts from one commit, made when `en-monorepo` was split (2026-10-16): the history before that is in the archived `en-monorepo` (`~/Projects/en-monorepo`), where the package lived at `packages/<name>`. Run this lookup and the `git log` of section 2 there too, on that folder: here they print nothing older than the split.

  If it prints a former folder, every lookup of section 2 runs for the old name, folder and scope too. A former folder that several packages print is a package they were split from: its history is context, not the package's own.

Take the working tree's fingerprint now, on the host, and keep it: section 5 compares against it.

```sh
{ git status --porcelain=v1 -z; git diff HEAD --binary; git ls-files -o --exclude-standard -z | xargs -0 -r sha256sum; } | sha256sum
```

It changes on any write to a tracked or untracked file, including a second write to a file that was already modified.

## 2. Read before judging

- **The whole package**: manifest, `tsconfig*.json`, `eslint.config.js`, `vitest.config.ts`, its own `.gitignore` or `.npmignore` if it has one (without a `files` field, it changes what `pnpm pack` ships), `src/`, `__tests__/`, README, and its `CLAUDE.md` if it has one.
- **The rules**: the root `CLAUDE.md` (already in context) and the ADRs in `docs/adr/`.
- **What is already known**: the items of `docs/backlog.md` that name the package.
- **Why it is the way it is**: `git log --oneline -- <folder>`, the specs that name it (`git grep -l -E '<package>([^a-z0-9-]|$)' -- docs/specs`: the class keeps `@enardo/email` from matching `@enardo/email-nodemailer`) and those of branches scoped to it (`git grep -l -E '^branch: [a-z]+/<scope>/' -- docs/specs`). A choice a spec made on purpose is judged against its reason, not as an accident.
- **Its consumers**: the packages that depend on it (`git grep -l '"<package>"' -- '*package.json'`), and how they use it: `git grep -n -E "[\"']<package>(/[^\"']*)?[\"']" -- ':!*package.json' ':!pnpm-lock.yaml' ':!*.md'` finds the imports, and a config package's `extends` of a subpath. An API is judged from the side that calls it too. The projects that install the package from the registry live in repos of their own, which this one cannot see: ask the user for the uses that matter, rather than judge an export unused because nothing here imports it.

## 3. What to judge

First, the conventions that the root and package `CLAUDE.md` files and the ADRs state for this kind of package. Then these questions, which no convention answers:

- **Boundaries.** Does it have one reason to exist? Does a contract carry a technology? Does it do another package's job, or leave its own to its consumers? Should it be split, or merged?
- **The API from the consumers' side.** Exports nobody uses; logic its dependents rebuild around it; copies of its types in other packages.
- **Type soundness.** Guards and casts that claim more than they check; `any` that reaches consumers, including through published declarations whose types come from a devDependency.
- **Failure paths.** What it throws, and whether a caller can tell the cases apart; what it reads that it does not control; what ends up in a log or a serialized error; timers, streams and handles left open.
- **Runtimes.** Where `src/` runs (Node, browsers, both), and whether its tests run there.
- **The manifest as if published.** Where each dependency is declared, `exports`, `files`, `sideEffects`, and what the package would ship: `pnpm --filter <package> pack --dry-run --json` lists the files. Never `pack` without `--dry-run`, which writes a tarball at the repo root.
- **Its own dependencies.**
  - How far behind their latest major they are: `pnpm --filter <package> outdated`. Leave aside every dependency the manifest declares as `catalog:`: the catalog is upgraded repo-wide.
  - Their advisories. `pnpm audit --json` ignores `--filter` and always covers the whole lockfile, and its paths cannot be filtered by package: they stop at 100 per finding, and never go through a workspace package. An advisory applies when the package's tree holds its `module_name` at the `version` of one of its `findings`. `pnpm --filter <package> list --depth Infinity --parseable` lists that tree, through the workspace packages it uses, one folder per package, named `node_modules/.pnpm/<name>@<version>…` (`/` becomes `+` in a scoped name). The tree is wider than the package: it holds the devDependencies of the workspace packages it uses, and the catalog's tooling, whose advisories apply to every package and belong to a repo-wide item, not to this assessment. `--prod` narrows it to what the package ships, but leaves out its peers: an adapter's driver, and the driver's advisories, disappear from it. For each advisory that applies, read every advisory on the same module: one `patched_versions` alone can leave others open.
  - The version the report proposes to move to is audited itself: a later version can bring advisories that the installed one does not have. In a throwaway container, `docker run --rm node:24-bookworm sh -c 'mkdir /a && cd /a && npm init -y >/dev/null && npm i --package-lock-only <module>@<version> >/dev/null && npm audit --json'`. The module's own advisories are the objects in `vulnerabilities["<module>"].via`; a string in `via` names a dependency. The other keys of `vulnerabilities` belong to its dependencies, and a module with no advisory of its own has no key, even when its dependencies have some (`bcrypt` 5.1.1).
- **Tests and docs.** Do the tests pin the contract the README states? Which plausible wrong implementation would pass them all? Do the README and the JSDoc describe what the code does?

The list does not bound the assessment. Anything else that weakens the package counts.

The assessment stays on the package. Its consumers and its adapters are read to judge its API from their side, but their defects are not its findings. A problem is the package's when a change to the package fixes it: a contract that says nothing of what a call rejects with has a problem of its own; an adapter that ignores an option the contract defines has a problem of the adapter's, even when it shows through the contract. A defect of another package gets one line in the report (section 6, *Outside the package*), for that package's own assessment.

## 4. Probes

Every bug, and every claim about how the code or a tool behaves, is probed, following the root `CLAUDE.md`: commands through `./dev.sh exec`, never `pnpm` on the host; a package outside the lockfile in a throwaway container; a probe through `dist/` after `./dev.sh exec pnpm exec turbo run build --filter=<package>... --force`; a wrong implementation on a copy outside the repo, never in the working tree. A probe that writes nothing is best: `./dev.sh exec node --input-type=module -e '…'` importing a `dist/index.mjs` by its path in the container, under `/workspaces/enardo-packages`. A probe that looks for processes by name, to find a handle left open, follows the rule in `.claude/agents/reviewer.md` (*Rules*): it must not match itself.

What you could not probe is marked *not probed*, never stated as fact.

## 5. Read-only

Write nothing in the repo: no source, no docs, no backlog, no `CLAUDE.md`, no untracked file. Build outputs (`dist/`, turbo's cache) may change. Never move the working tree: no `checkout`, `switch`, `stash` or `reset`; an older version of a file is `git show <rev>:<path>`.

At the end, take the fingerprint of section 1 again and compare. If it differs, say so in the report, with what `git status` shows.

What you propose for the repo stays a draft in your report. Writing it is a later step, on a branch, when the user asks for it. When a backlog item calls for the assessment, and also for changes (an upgrade, a fix), the assessment comes first, read-only; the changes follow in that item's spec.

## 6. Report

In the language of the conversation. The drafts meant for the repo (the `CLAUDE.md`, the backlog items) are in English, like the repo's docs.

1. **Overall judgment.** A few paragraphs: whether the package is sound, its main strength, its main risk.
2. **Problems, most severe first.** Use one scale, so that the assessments of different packages compare:
   - **bug**: wrong behavior today;
   - **contract**: an API, a type or a manifest that will cause bugs in consumers, or blocks a planned use;
   - **convention**: a rule of the repo broken, with its concrete cost;
   - **hygiene**: docs, tests, tooling.

   For each: where (`file:line`), what, a scenario where it bites, the evidence (the probe and its result, or *not probed*), a direction for the fix, and the backlog item that already holds it, if one does.
3. **Choices to keep.** What is right and not obvious, so that later work does not undo it. These are the candidates for the package's invariants.
4. **`CLAUDE.md`.** Whether the package needs one, or what its existing one lacks. If it needs one, a draft with the structure of the existing ones (`packages/errors/CLAUDE.md`): one line on the package's purpose, then *Layout*, *Invariants*, *Tests*, *Public API changes*. It holds only what the root `CLAUDE.md` does not. When the root already covers the package, say that it needs none.
5. **Backlog drafts.** One item per problem worth a branch of its own, in the format of `docs/backlog.md` (what, why, where it comes from), with the source "the architectural review of `<package>` (<date>)". A problem that the backlog already holds gets no draft: name its item in the list above.
6. **Not verified.** The suspicions that no probe settled, each with what would settle it.
7. **Outside the package.** The defects found in other packages, one line each: the package, what, the evidence. No severity and no draft: they are left to that package's own assessment.

If the package is sound, say so. Inventing minor problems to look thorough wastes the user's time.
