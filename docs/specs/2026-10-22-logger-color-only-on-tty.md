---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/logger"]
branch: fix/logger/color-only-on-tty
---

# Color the console logger's pretty output only where colors are wanted

## Why

The console logger colors its `pretty` output (the default format) wherever it writes: through a pipe or into a file, and with `NO_COLOR` set. A server that keeps the defaults, as Cambusa's api-server does, sends ANSI escape codes to its log collector. The root cause: `createPrettyFormat` always puts `winston.format.colorize({ all: true })` first, and `logform/colorize` sets the global `colors.enabled = true` when it loads, so `@colors/colors`' own TTY and environment checks never apply.

From the backlog's *Queued* item, out of the architectural review of `@enardo/logger` (2026-10-22).

## Probes

All in the dev container, Node v24.21.0, winston 3.19.0, `@colors/colors` 1.6.0, after `pnpm exec turbo run build --filter=@enardo/logger... --force`.

- `createLogger("console").info("hi", { a: 1 })` from `dist/`, piped to `od -c` → `\033[32m` before the level; with `NO_COLOR=1` → the same escapes.
- `logform/colorize.js` → line 9, `colors.enabled = true` at load, global to every user of `@colors/colors/safe`: a per-logger choice has to leave `colorize()` out of the format, not toggle the flag.
- `winston/transports/console.js` → with no `stderrLevels` and no `consoleWarnLevels` (`_stringArrayToSet(undefined)` is `{}`, line 107), every entry goes to `console._stdout`, which is `process.stdout`. `createConsoleLogger` passes neither (`src/winston/winston-console.factory.ts:102`): `process.stdout` is the only stream to check.
- A piped `process.stdout` → `isTTY` is `undefined`, and it has no `hasColors` method.
- `tty.WriteStream.prototype.getColorDepth(env)`, which `hasColors()` compares against 16 colors →
  - `{}`, `TERM=dumb`, `NODE_DISABLE_COLORS=1`, `TERM=xterm NO_COLOR=1` → 1 (no colors); `TERM=xterm`, `TERM=xterm NO_COLOR=` (empty) → 4.
  - `FORCE_COLOR` `""`, `"1"`, `"true"` → 4; `"2"` → 8; `"3"` → 24; `"0"`, `"false"`, `"yes"` → 1.
  - `FORCE_COLOR=1 NO_COLOR=1` → 4, with Node's warning that `NO_COLOR` is ignored.
- `script` run inside the container → `process.stdout.isTTY` is `true`, `hasColors()` `false`: that inner shell has no `TERM`. Run from the host's terminal, `./dev.sh exec` sets `TERM=xterm` and `hasColors()` is `true` (the critic's probe): interactive sessions keep their colors. With `NO_COLOR=1` → `false`.
- `@colors/colors/safe` before and after `import("./dist/index.mjs")` → `enabled` turns from `false` to `true` (the critic's probe): winston's config loads `logform/levels.js`, which requires `colorize.js`.
- Inside a vitest worker of this package → `FORCE_COLOR`, `NO_COLOR` and `TERM` unset, `process.stdout.isTTY` unset, no `hasColors`: every existing test runs on the non-TTY path.
- `git grep` for `raw()`, `\u001b`, `\x1b` in `packages/logger` → no existing test asserts on ANSI codes; they read `captureConsoleLines().lines()`, which strips them (`__tests__/support/capture-console.ts`).

## Decisions

Proposed at intake and approved by the user:

- **The default format stays `pretty`**, on a terminal or not. Only the colors follow the output. Switching to `json` off a terminal was the other option: it changes the shape of every line a collector receives, a new major, and a server that wants JSON already says so.
- **Node's color conventions**, not rules of our own:
  - `FORCE_COLOR`, when set, decides on its own, as Node does: colors for `""`, `"1"`, `"2"`, `"3"`, `"true"`, none for any other value; `NO_COLOR` is then ignored, as Node ignores it.
  - Otherwise, colors only when `process.stdout.isTTY` and `process.stdout.hasColors()`, which applies `NO_COLOR`, `NODE_DISABLE_COLORS` and `TERM=dumb`.
  - Other options for `FORCE_COLOR`, not taken. Calling `tty.WriteStream.prototype.getColorDepth` on a stream that is no TTY borrows a method from a prototype, outside the documented use. Testing `util.styleText("red", "x", { stream: process.stdout }) !== "x"` applies Node's whole rule (the critic's probe), but it derives a predicate from a side effect, and which Node versions check the stream there is not probed.
- **A `colors?: boolean` option on `ConsoleLoggerOptions`** wins over all of the above. The `json` format never colors, with or without it.
- **The choice is made once, when the logger is created**, as the format is today; its children share it.
- **A minor: 1.1.0.** A new option, and a fix of what the default was meant to do; the shape of a line does not change. Publishing is a session of its own. The version also ships the fixes of `fix/logger/reserved-entry-fields`, merged with the version left at the published 1.0.0.

## Open questions

- The `colors` option: the critic objects that no consumer needs it, since `FORCE_COLOR` and `NO_COLOR` cover both directions, and that without it the release is a patch (1.0.1), with the option a later minor when a need shows. Its one difference from the variables: it is scoped to the logger, where `FORCE_COLOR` also reaches child processes and other libraries.

## Changes

`@enardo/logger`:

- `src/logger.ts`: `colors?: boolean` on `ConsoleLoggerOptions`, with JSDoc: what decides the default, that it wins, that `json` ignores it.
- `src/winston/winston-console.factory.ts`: a function that resolves the option, the environment and `process.stdout` into one boolean, read at creation; `createPrettyFormat` includes `colorize({ all: true })` only when it is `true`.
- `package.json`: `version` 1.1.0.
- `docs/backlog.md`: the item leaves, in a commit of its own.

## Test cases

Through `createLogger("console", …)`, reading `captureConsoleLines().raw()`. Each case sets `process.stdout.isTTY` and `hasColors` on the real `process.stdout` and the environment (`FORCE_COLOR`, `NO_COLOR` unset unless named), and restores them after. "Colored" means the raw line holds an ANSI escape around both the level and the message (`all: true`); "plain" means it holds none.

1. Default options, `isTTY` unset, no `hasColors` → plain. Fails today: the bug.
2. Default options, `isTTY` unset, `NO_COLOR=1` → plain.
3. Default options, `isTTY: true`, `hasColors()` returning `true` → colored.
4. Default options, `isTTY: true`, `hasColors()` returning `false`, no `NO_COLOR` → plain: the logger asks `hasColors()`, not the variables alone.
5. Default options, `isTTY: false`, a `hasColors()` returning `true` → plain: `isTTY` is checked.
6. `FORCE_COLOR` each of `""`, `"1"`, `"2"`, `"3"`, `"true"`, `isTTY` unset → colored.
7. `FORCE_COLOR` each of `"0"`, `"false"`, `"yes"`, `isTTY: true`, `hasColors()` returning `true` → plain.
8. `FORCE_COLOR=1`, `NO_COLOR=1`, `isTTY` unset → colored.
9. `colors: true`, `isTTY` unset, `FORCE_COLOR=0` → colored.
10. `colors: false`, `isTTY: true`, `hasColors()` returning `true`, `FORCE_COLOR=1` → plain.
11. `format: "json"`, `colors: true`, `isTTY: true`, `hasColors()` returning `true` → plain.
12. Created with `isTTY: true` and `hasColors()` returning `true`, then `isTTY` unset before logging → colored, and so is a `child()` of it: the choice is made at creation.
13. The text of a colored line with the codes stripped equals the plain line of the same entry, with `timestamp: false`: colors change nothing else.

## Risks

`medium`: a consumer reading a terminal through a tool that is no TTY (a `docker logs` without `-t`, a CI log) loses its colors. `FORCE_COLOR=1` or `colors: true` brings them back, and the JSDoc says so. Whether Cambusa's `pnpm dev` (`turbo run dev`, then `tsx watch`) gives the api-server a terminal is not probed: if not, its dev logs lose their colors, and `FORCE_COLOR=1` in its dev script, in Cambusa's repo, restores them.

## Out of scope

- The default format off a terminal (see *Decisions*).
- The README of `@enardo/logger`: the last *Queued* item, after this one.
- Writing some levels to stderr.
- The global `colors.enabled = true` that loading winston sets: other code that uses the same `@colors/colors` instance keeps coloring into pipes. No consumer does today.

## Plan

1. Test-first: cases 1–13 in `__tests__/winston/console-colors.test.ts`, red where the current code colors (1, 2, 4, 5, 7, 10). Then the option and the resolution. Green, committed.
2. JSDoc and the version. Committed.
3. The backlog item leaves. Committed.
