---
status: done
type: chore
packages: [repo]
branch: chore/repo/arch-review-skill
---

# A skill for the architectural assessment of a package

## Why

The user assesses the monorepo's packages with a prompt they paste each time, changing only the package name (2026-10-14). It asks for a read-only analysis, honest judgments, the bugs found, a list of problems ranked by severity, and whether the package needs a `CLAUDE.md` of its own. Past assessments fed the workflow: those of `@enardo/errors` and `@enardo/http-status` became the specs of `fix/errors/harden-base-error` and `fix/http-status/harden-status-registry`, and the one of `@enardo/http` items of `docs/backlog.md` ("From the architectural review of `@enardo/http` (2026-09-25)").

The prompt is generic. It asks for "the community's best practices" and knows nothing the repo has learned:

- **The repo's own criteria.** The root `CLAUDE.md`, the ADRs and the packages' `CLAUDE.md` files state what a package here must be: ports and adapters with the drivers as peers, a manifest judged as if published, `sideEffects: false`, `BaseError`, type guards that claim only what they check (ADR 0003), browser tests where `src/` runs in browsers.
- **The probe discipline.** A claim about a tool or the code is probed in the dev container, or marked as not probed. "Read-only" in the prompt does not say whether probes are allowed.
- **Where findings go.** An item enters *To evaluate* in the backlog, with what, why, and its source named in full. The prompt does not read the backlog, so it can report a known problem as new, and its findings have to be rewritten into the backlog's format.
- **The existing package `CLAUDE.md` files** (`errors`, `http-client`, `http-status`) share one structure, which a new one should follow.

The first queued item of the backlog, `chore/email-nodemailer/architectural-assessment`, is an assessment: the skill would run first there.

## Probes

Run on `master` (`9708694`), in the dev container (`en-monorepo-dev-1`), on 2026-10-14.

- **`pnpm audit` ignores `--filter`.** `pnpm --filter @enardo/email-nodemailer audit --json` and `pnpm audit --json` report the same totals (1 low, 16 moderate, 19 high, 2 critical), and the filtered run lists `react-router`, which only `@cambusa/web` uses. Each advisory's paths start at an importer (`packages__email-nodemailer>nodemailer`, `projects__cambusa__apps__api-server>nodemailer`), so the skill keeps those that start at the assessed package's importer. **Corrected after review**: paths cannot select a package's advisories. They stop at 100 per finding, so a package can drop out of them (probed by the review, with one more importer), and none goes through a workspace package (0 of 456 today), so an app misses what its workspace dependencies bring. The skill matches each advisory's `module_name` and `version` against `pnpm --filter <package> list --depth Infinity --parseable`, which honors the filter and follows workspace links: for the api-server it lists `tar` 6.2.1, `qs` 6.15.3, `proxy-addr` 2.0.7, and `winston`, which comes through `@enardo/logger`.
- **`pnpm --filter <package> outdated` honors the filter.** For `@enardo/email-nodemailer`, it lists the package's own dependencies (`nodemailer` 6.10.1, latest 10.1.0; `@types/nodemailer` 6.4.24, latest 8.0.2), and the catalog's tooling (`typescript`, `eslint`, `prettier`, `tsdown`, `@types/node`), which is repo-wide and not the package's to upgrade.
- **Claude Code's skill format**, from its documentation (`code.claude.com/docs/en/skills`, read on 2026-10-14), **not probed**; verification 1 and 2 exercise it:
  - a project skill is `.claude/skills/<name>/SKILL.md`, invoked as `/<name>`;
  - the frontmatter fields used here are `name`, `description` and `argument-hint` (**corrected after review**: first written without `name`, which the file has); `$ARGUMENTS` expands to the arguments of the invocation;
  - `allowed-tools` pre-approves tools and does not restrict them; `disallowed-tools` removes tools "while this skill is active", for a span the page does not define;
  - `disable-model-invocation: true` keeps Claude from loading the skill on its own;
  - `context: fork` runs the skill in a subagent.

## The skill

`.claude/skills/arch-review/SKILL.md`, invoked as `/arch-review <package>` (`@enardo/logger`, `@cambusa/catalog`). Written in English, like the repo's other agent definitions. Short: the criteria the repo already states are referenced, not copied, so they cannot drift apart.

1. **Input.** A workspace package name. Without one, it asks which. It finds the folder from the `name` fields of the workspace's `package.json` files, and the package's kind: shared contract, shared adapter, other shared library, config package, project package (bounded context, contracts), app.
2. **Context, read before any judgment**:
   - the whole package: manifest, configs, `src/`, `__tests__/`, README, its `CLAUDE.md`;
   - the root `CLAUDE.md` (already loaded), the project's `CLAUDE.md` for a project package, the ADRs;
   - `docs/backlog.md`: items that name the package;
   - the package's history: `git log --oneline -- <folder>`, and the specs whose `packages:` lists it, for the reasons behind its choices (**corrected after review**: the specs that name the package, and those of branches scoped to it, under its current and former names);
   - its dependents (`git grep` of the name in `package.json` files), and how they use it: an API is judged from its consumers too.
3. **Criteria.** The conventions of the root and package `CLAUDE.md` files and the ADRs that apply to the package's kind. Then lenses that no convention covers, each a question, not a checklist:
   - **Boundaries**: one reason to exist; a technology in a contract; something that belongs to another package, or another package's job done here; a split or a merge.
   - **The API from the consumers' side**: exports nobody uses; logic that dependents rebuild around it; copies of its types elsewhere.
   - **Type soundness**: guards and casts that claim more than they check; `any` reaching consumers, including through published declarations whose types come from a devDependency.
   - **Failure paths**: what it throws; what it reads that it does not control; what reaches a log or a serialized error; timers, streams and handles left open.
   - **Runtimes**: where `src/` runs, and whether its tests run there.
   - **The manifest as if published**: dependency placement, `exports`, `files`, `sideEffects`, what `pnpm pack` would ship.
   - **Its own dependencies**: how far behind their latest major (`pnpm --filter <package> outdated`, the catalog's tooling aside), and their advisories (`pnpm audit --json`, matched against the package's tree: see *Probes*).
   - **Tests and docs**: whether the tests pin the contract the README states, and whether a plausible wrong implementation passes them; whether the README and JSDoc describe the code.
   - **Anything else**: the lenses do not bound the assessment. Judge as an architect, not against a list, and don't call something a problem only because a practice exists elsewhere.
4. **Probes.** Allowed, and expected for every bug and every claim about behavior. In the dev container through `./dev.sh exec`; a package outside the lockfile in a throwaway container; a probe through `dist/` after `turbo run build --filter=<package>... --force`; a wrong implementation on a copy of the package outside the repo, never in the working tree, as the root `CLAUDE.md` says (**corrected while writing the skill**: first written "in the scratchpad", which is on the host, where the dev container cannot see it). A claim not probed is marked as such.
5. **Read-only.** The skill writes nothing tracked, nor any untracked file in the repo: it records `git status --porcelain` at the start and checks it unchanged at the end (**corrected after review**: a fingerprint of the status, the diff against `HEAD` and the untracked files' contents, since `git status` stays the same when a file already modified is written again). Build outputs (`dist/`, turbo's cache) may change. The backlog items and the `CLAUDE.md` it proposes are drafts in its report; writing them is a later step, on a branch, when the user asks.
6. **Output**, in the language of the conversation; the drafts meant for the repo in English, as its docs are:
   1. **Overall judgment**: a few paragraphs, the package's main strength and its main risk.
   2. **Problems, most severe first**, on one scale so that assessments of different packages compare: **bug** (wrong behavior today), **contract** (an API, a type or a manifest that will cause bugs in consumers or blocks a planned use), **convention** (a rule of the repo broken, with its concrete cost), **hygiene** (docs, tests, tooling). Each with where (`file:line`), what, a scenario where it bites, the evidence (the probe and its result, or *not probed*), a direction for the fix, and the backlog item that already holds it, if any.
   3. **Choices to keep**: what is right and not obvious, so later work does not undo it. These are the candidates for the package's invariants.
   4. **`CLAUDE.md`**: whether the package needs one, or what its existing one lacks, with a draft that follows the structure of the existing ones (purpose, *Layout*, *Invariants*, *Tests*, *Public API changes*) and holds only rules the root `CLAUDE.md` does not. None, when the root covers the package.
   5. **Backlog drafts**: one item per problem worth a branch, in the backlog's format, with the source "the architectural review of `<package>` (<date>)".
   6. **Not verified**: the suspicions that no probe settled, each with what would settle it.

## Decisions (to confirm at checkpoint 1)

1. **A skill, not a subagent.** It runs in the conversation, so the discussion that follows has the findings in context, and acting on them (the backlog, a spec) needs no hand-over. The `reviewer` is a subagent for its independence from the author of a diff; an assessment usually starts in a fresh session, which wrote nothing of the package. `context: fork` stays unused.
2. **Claude may load it too**, not only the user: `disable-model-invocation` stays off, so that the agent can run it when it takes `chore/email-nodemailer/architectural-assessment` from the backlog. This changes what was proposed in the conversation (manual invocation only). The `description` says when it applies (an architectural assessment of a package, asked for) and when it does not (the review of a diff, which is the `reviewer`'s).
3. **Read-only by a check, not by a tool restriction.** `disallowed-tools` would remove `Write` and `Edit` for a span that the documentation does not define, and the discussion after the report may need them. The fingerprint check at the end shows a write instead of preventing it.
4. **No model or effort override.** The session's settings apply.
5. **One line in the root `CLAUDE.md`**, in *Workflow*: an architectural assessment of a package runs with `/arch-review <package>`, and its findings enter the backlog's *To evaluate* when the user approves them.
6. **No test.** A skill is a prompt: the verification is a run.

## Found while exploring

To add to *To evaluate* in `docs/backlog.md`, in a commit of their own, if approved:

- **`pnpm audit` reports 38 advisories over the lockfile** (1 low, 16 moderate, 19 high, 2 critical), on 2026-10-14, by package, with a path that reaches it:
  - `proxy-addr` 2.0.7, critical, patched in 2.0.8: `api-server>@ts-rest/express>express>proxy-addr`;
  - `tar` 6.2.1, critical and high, patched in 7.5.7: `password-hasher>bcrypt>@mapbox/node-pre-gyp>tar` (**corrected after review**: twelve advisories, 1 critical, 8 high, 3 moderate, all closed from 7.5.21, the critical one from 7.5.19; 7.5.7 was the first advisory's fix only);
  - `nodemailer` 6.10.1: already the first queued item;
  - `react-router` 8.1.0, high, patched in 8.3.0: `@cambusa/web`;
  - `qs` 6.15.3, moderate, patched in 6.15.4: `api-server>@ts-rest/express>express>body-parser>qs` (**corrected after review**: two advisories, both closed from 6.16.0);
  - `source-map-js` 1.2.1 and `brace-expansion` 1.1.18 and 5.0.9, through the dev tooling (`vitest`, `eslint`) and `bcrypt`'s build.

  Whether a lockfile refresh within the current ranges fixes them, and whether `bcrypt` 6 drops `node-pre-gyp`, is not probed. (**Corrected after review**: the manifests settle the first part. A refresh cannot fix `react-router`, pinned to exactly `8.1.0`, nor `tar`, which `@mapbox/node-pre-gyp` 1.0.11 holds at `^6.1.11`; `proxy-addr` and `qs` are within range.) From the spec of `chore/repo/arch-review-skill` (2026-10-14).

## Out of scope

- **Assessing a package**: the skill's first run on a real target is `chore/email-nodemailer/architectural-assessment`, a branch of its own.
- **Fixing the advisories**: the item above.
- **A shared base for the `reviewer` and the skill**: both name the same probe rules, the reviewer for a diff. The skill points to the root `CLAUDE.md`, which holds them, rather than to the reviewer. **Corrected after review**: the rule for a probe that looks for processes by name is only in the two agent definitions, so the skill points to the reviewer's for that one.

## Verification

1. **The skill loads**: the user sees `/arch-review` in the `/` menu, with its argument hint.
2. **A run, in a fresh session**, by the user at checkpoint 2: `/arch-review @enardo/id-generator`. It is small, and it holds a known problem, a contract and an adapter in one package, which the backlog already queues as `refactor/repo/split-contracts-from-adapters`. The report should:
   - follow the six sections of the output;
   - report the known problem, and name its backlog item instead of drafting a new one;
   - mark each finding probed or not probed;
   - end with the working tree's fingerprint as it started.

   The run's report is not written anywhere: what it finds goes through the backlog later, if the user wants.
3. **`pnpm verify`** stays green (the change touches no package).

**Results** (2026-10-14): the user ran verification 1 and 2 in a fresh session, and found the analysis good and in line with what they expected. `pnpm verify` is green on every commit of the branch.

## Review follow-ups

**Added after the first review**, which found the skill true to the spec's points and decisions, and its other commands right.

1. **The backlog item's fixed versions** (blocking). `tar` 7.5.7 and `qs` 6.15.4 fixed one advisory each; the summary that produced them read one advisory per module. Corrected in the item and in *Found while exploring*, with what a lockfile refresh can and cannot fix.
2. **The advisories of a package** (blocking). The importer patterns left out the apps (`projects__cambusa__apps__api-server`), and paths cannot select a package's advisories anyway (*Probes*). The skill now matches advisories against the package's tree, and reads every advisory of a module before naming a fixed version.
3. **Writes the skill invited, or could miss.** `pnpm pack` writes a tarball at the repo root: the skill asks for `--dry-run --json`, which writes nothing (probed by the review). The `git status` check became a fingerprint (probed in a scratch repository: a second write to a modified file and to an untracked file both change it).
4. **Lookups.** The spec lookup by name matched `@enardo/email-nodemailer` for `@enardo/email`, the branch scope was undefined, nothing followed a rename (`@enardo/http-client` was `@enardo/http`), and the consumer lookup returned every mention. Each is fixed and probed: the lookup by name for `@enardo/email`, by scope for `cambusa/catalog` and `http`, `git log --follow --diff-filter=R` for the rename, and the imports of `@enardo/database` (3 lines instead of 59).
5. **Smaller points.** The catalog's tooling is every `catalog:` dependency, not a list of six; `turbo` runs as `pnpm turbo` in the container; a package's own `.gitignore` joins the reading list; a backlog item that asks for an assessment and for changes gets the assessment first, read-only.

## Second review follow-ups

**Added after the second review**, which found the first review's findings fixed and the corrected facts right.

1. **The rename lookup reported other packages' renames** (blocking). Follow-up 4 had probed it on `@enardo/http-client` only. `git log --follow` also follows a manifest created as a copy of another's, and `--diff-filter=R` hid the copy and printed that other package's renames: `transaction-manager` got `entity`, the web app got `core`. The lookup now stops at the first line that is not a rename. Probed over every package: the two false results go, and `http`, `entity`, `uow-repository-2` and `uow-repository-2-mongo` stay. The bounded contexts and `shared` print `projects/cambusa/packages/core`, the package they were split from; the skill says that such a folder is context, not a former name.
2. **`--prod` leaves out peers**: `@enardo/password-hasher`'s production tree has no `bcrypt` and no `tar` (probed by the review, and again). The skill says so, and that the full tree holds the devDependencies of the workspace packages used and the catalog's tooling, whose advisories belong to a repo-wide item.
3. **The consumer lookup missed the config packages**, which are used through `eslint.config.js` and an `extends` of a subpath. It now searches every file but manifests, the lockfile and Markdown, for the name with an optional subpath, in either quote: 30 uses each for `@enardo/typescript-config` and `@enardo/eslint-config`, still 3 for `@enardo/database`.

**Not verified**: `turbo` shows in every package's `list --parseable`, `--prod` included, presumably as the root's devDependency; a vulnerable root dependency would then match every package.

**Pre-existing, not on this branch**: `projects/cambusa/packages/identity/typecheck_output.txt` is tracked (`6893dc2`), the output of a `tsc` run on the host; and the root `CLAUDE.md` writes `turbo run build …` in commands meant for the container, where `turbo` alone is not on the `PATH`. The second review added a third: `pack --dry-run` of `@enardo/logger` ships `__tests__/` and `.turbo/turbo-build.log`, with no `files` field (so does `@enardo/id-generator`'s, seen while probing `pack`). It belongs to those packages' assessments.

## Plan

Each step ends with `pnpm verify` green and one commit.

1. **Spec** (this file).
2. **The skill**: `.claude/skills/arch-review/SKILL.md`.
3. **The line** in the root `CLAUDE.md`.
4. **Backlog**: the item of *Found while exploring*, if approved, in a commit of its own.
5. **Review** by the `reviewer`, checkpoint 2 with verification 1 and 2, integration.
